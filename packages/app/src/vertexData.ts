import type { GLCall } from '@wgd/core';

export interface CapturedVertexAttributes {
  /** Attribute rows across all instances, including repeats but excluding restart indices. */
  vertexCount: number;
  /** Number of indices in the selected draw, including restart markers; not multiplied by instances. */
  indexCount: number;
  /** CPU copy of the draw's index range, preserving its unsigned format; null for non-indexed draws. */
  indexBuffer: Uint8Array | Uint16Array | Uint32Array | null;
  /** Flattened attribute components in instance/vertex order, as before. */
  vertexAttributes: Map<string, number[]>;
}

function attributeShape(gl: WebGL2RenderingContext, type: number): [number, number] {
  switch (type) {
    case gl.FLOAT: case gl.INT: case gl.UNSIGNED_INT: return [1, 1];
    case gl.FLOAT_VEC2: case gl.INT_VEC2: case gl.UNSIGNED_INT_VEC2: return [1, 2];
    case gl.FLOAT_VEC3: case gl.INT_VEC3: case gl.UNSIGNED_INT_VEC3: return [1, 3];
    case gl.FLOAT_VEC4: case gl.INT_VEC4: case gl.UNSIGNED_INT_VEC4: return [1, 4];
    case gl.FLOAT_MAT2: return [2, 2];
    case gl.FLOAT_MAT3: return [3, 3];
    case gl.FLOAT_MAT4: return [4, 4];
    case gl.FLOAT_MAT2x3: return [2, 3];
    case gl.FLOAT_MAT2x4: return [2, 4];
    case gl.FLOAT_MAT3x2: return [3, 2];
    case gl.FLOAT_MAT3x4: return [3, 4];
    case gl.FLOAT_MAT4x2: return [4, 2];
    case gl.FLOAT_MAT4x3: return [4, 3];
    default: throw new Error(`Unsupported vertex attribute type: ${type}`);
  }
}

function componentBytes(type: number): number {
  switch (type) {
    case 0x1400: case 0x1401: return 1; // BYTE, UNSIGNED_BYTE
    case 0x1402: case 0x1403: case 0x140b: return 2; // SHORT, UNSIGNED_SHORT, HALF_FLOAT
    case 0x1404: case 0x1405: case 0x1406: return 4; // INT, UNSIGNED_INT, FLOAT
    default: throw new Error(`Unsupported vertex buffer format: ${type}`);
  }
}

function readComponent(data: DataView, offset: number, type: number, normalized: boolean): number {
  switch (type) {
    case 0x1400: { const v = data.getInt8(offset); return normalized ? Math.max(-1, v / 127) : v; }
    case 0x1401: { const v = data.getUint8(offset); return normalized ? v / 255 : v; }
    case 0x1402: { const v = data.getInt16(offset, true); return normalized ? Math.max(-1, v / 32767) : v; }
    case 0x1403: { const v = data.getUint16(offset, true); return normalized ? v / 65535 : v; }
    case 0x1404: { const v = data.getInt32(offset, true); return normalized ? Math.max(-1, v / 2147483647) : v; }
    case 0x1405: { const v = data.getUint32(offset, true); return normalized ? v / 4294967295 : v; }
    case 0x1406: return data.getFloat32(offset, true);
    case 0x140b: {
      const bits = data.getUint16(offset, true);
      const sign = bits & 0x8000 ? -1 : 1;
      const exponent = (bits >> 10) & 31;
      const fraction = bits & 1023;
      if (exponent === 31) return fraction ? NaN : sign * Infinity;
      return sign * (exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15));
    }
    default: throw new Error(`Unsupported vertex buffer format: ${type}`);
  }
}

/**
 * Reads VS inputs from the currently bound program and VAO, before a draw.
 * Each key is an active shader attribute name. Values are flattened in draw
 * order (including repeated indices), instance first, then vertex, then
 * component. Matrices use column-major order. Restart indices have no vertex.
 * This reads live buffer contents; it does not reconstruct historical bytes.
 */
export function captureVertexAttributes(gl: WebGL2RenderingContext, call: GLCall, args: readonly unknown[]): CapturedVertexAttributes {
  const attributes = new Map<string, number[]>();
  const result: CapturedVertexAttributes = { vertexCount: 0, indexCount: 0, indexBuffer: null, vertexAttributes: attributes };
  const indexed = call.name === 'drawElements' || call.name === 'drawElementsInstanced' || call.name === 'drawRangeElements';
  if (!indexed && call.name !== 'drawArrays' && call.name !== 'drawArraysInstanced') return result;
  const range = call.name === 'drawRangeElements';
  const count = Number(args[range ? 3 : indexed ? 1 : 2]);
  const instances = call.name === 'drawArraysInstanced' ? Number(args[3])
    : call.name === 'drawElementsInstanced' ? Number(args[4]) : 1;
  if (count <= 0 || instances <= 0) return result;
  const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  if (!program) return result;

  const oldReadBuffer = gl.getParameter(gl.COPY_READ_BUFFER_BINDING) as WebGLBuffer | null;
  const buffers = new Map<WebGLBuffer, DataView>();
  function readBuffer(buffer: WebGLBuffer): DataView {
    const cached = buffers.get(buffer);
    if (cached) return cached;
    gl.bindBuffer(gl.COPY_READ_BUFFER, buffer);
    const bytes = new Uint8Array(gl.getBufferParameter(gl.COPY_READ_BUFFER, gl.BUFFER_SIZE));
    gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, bytes);
    const view = new DataView(bytes.buffer);
    buffers.set(buffer, view);
    return view;
  }

  try {
    const vertices: number[] = [];
    if (indexed) {
      const buffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
      if (!buffer) throw new Error('The selected draw has no index buffer.');
      const type = Number(args[range ? 4 : 2]);
      const offset = Number(args[range ? 5 : 3]);
      if (type !== gl.UNSIGNED_BYTE && type !== gl.UNSIGNED_SHORT && type !== gl.UNSIGNED_INT) {
        throw new Error('Unsupported index buffer format.');
      }
      const bytes = componentBytes(type);
      const restart = 2 ** (bytes * 8) - 1;
      const data = readBuffer(buffer);
      result.indexCount = count;
      result.indexBuffer = type === gl.UNSIGNED_BYTE ? new Uint8Array(count)
        : type === gl.UNSIGNED_SHORT ? new Uint16Array(count) : new Uint32Array(count);
      for (let i = 0; i < count; i++) {
        const index = readComponent(data, offset + i * bytes, type, false);
        result.indexBuffer[i] = index;
        if (index !== restart) vertices.push(index);
      }
    } else {
      const first = Number(args[1]);
      for (let i = 0; i < count; i++) vertices.push(first + i);
    }

    result.vertexCount = vertices.length * instances;

    const activeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number;
    for (let i = 0; i < activeCount; i++) {
      const info = gl.getActiveAttrib(program, i);
      if (!info) continue;
      const location = gl.getAttribLocation(program, info.name);
      if (location < 0) continue;
      const [columns, components] = attributeShape(gl, info.type);
      const slots = columns * info.size;
      const values = new Array<number>(instances * vertices.length * slots * components);
      for (let slot = 0; slot < slots; slot++) {
        const index = location + slot;
        const enabled = gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_ENABLED) as boolean;
        const constant = gl.getVertexAttrib(index, gl.CURRENT_VERTEX_ATTRIB) as Float32Array | Int32Array | Uint32Array;
        const buffer = enabled ? gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) as WebGLBuffer | null : null;
        if (enabled && !buffer) throw new Error(`Attribute ${info.name} has no buffer.`);
        const data = buffer ? readBuffer(buffer) : null;
        const size = gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_SIZE) as number;
        const type = gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_TYPE) as number;
        const integer = gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_INTEGER) as boolean;
        const normalized = !integer && gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED) as boolean;
        const packed = type === gl.INT_2_10_10_10_REV || type === gl.UNSIGNED_INT_2_10_10_10_REV;
        const bytes = packed ? 4 : componentBytes(type);
        const stride = (gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_STRIDE) as number) || (packed ? 4 : size * bytes);
        const offset = gl.getVertexAttribOffset(index, gl.VERTEX_ATTRIB_ARRAY_POINTER);
        const divisor = gl.getVertexAttrib(index, gl.VERTEX_ATTRIB_ARRAY_DIVISOR) as number;
        for (let instance = 0; instance < instances; instance++) {
          for (let vertex = 0; vertex < vertices.length; vertex++) {
            const sourceIndex = divisor > 0 ? Math.floor(instance / divisor) : vertices[vertex];
            const address = offset + sourceIndex * stride;
            const destination = ((instance * vertices.length + vertex) * slots + slot) * components;
            for (let component = 0; component < components; component++) {
              let value = component === 3 ? 1 : 0;
              if (!enabled) {
                value = constant[component];
              } else if (data && component < size) {
                if (packed) {
                  const bits = component === 3 ? 2 : 10;
                  const mask = (1 << bits) - 1;
                  value = (data.getUint32(address, true) >>> (component * 10)) & mask;
                  const signed = type === gl.INT_2_10_10_10_REV;
                  if (signed && (value & (1 << (bits - 1)))) value -= 1 << bits;
                  if (normalized) value = signed ? Math.max(-1, value / ((1 << (bits - 1)) - 1)) : value / mask;
                } else {
                  value = readComponent(data, address + component * bytes, type, normalized);
                }
                if (!integer) value = Math.fround(value);
              }
              values[destination + component] = value;
            }
          }
        }
      }
      attributes.set(info.name, values);
    }
    return result;
  } finally {
    // COPY_READ_BUFFER avoids changing the VAO's element/attribute bindings.
    gl.bindBuffer(gl.COPY_READ_BUFFER, oldReadBuffer);
  }
}
