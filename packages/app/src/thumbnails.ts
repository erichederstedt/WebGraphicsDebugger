import { replayCalls, type GLCall, type ObjectRegistry } from '@wgd/core';

export interface FrameSnapshot {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  pixelAt(x: number, y: number): readonly [number, number, number, number];
}

function makeSnapshot(pixels: Uint8ClampedArray, width: number, height: number): FrameSnapshot {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext('2d')!;
  ctx2d.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);

  return {
    canvas,
    width,
    height,
    pixelAt(x, y) {
      const i = (y * width + x) * 4;
      return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    },
  };
}

/**
 * Replays the frame up to and including `targetCallId` against the still-live
 * (paused) `gl` context and reads back whatever's in the framebuffer at that
 * point. Done fresh per call rather than baked for the whole frame up front,
 * so cost scales with whatever's actually being looked at, not every draw in
 * the capture — the caller is expected to cache this by call id and only
 * call again when the selection actually changes.
 */
export function snapshotForCall(gl: WebGL2RenderingContext, calls: readonly GLCall[], registry: ObjectRegistry, targetCallId: number, debugMode = DRAW_CALL_DEBUG_MODE.NONE): FrameSnapshot | null {
  if (calls.length === 0 || targetCallId < 0) return null;
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (width === 0 || height === 0) return null;


  replayCalls(gl, calls, registry, targetCallId, (target: Record<string, (...a: unknown[]) => unknown>, call: GLCall, args: unknown[], commandIndex: number, stopAt: number) => {
    if (debugMode === DRAW_CALL_DEBUG_MODE.HIGHLIGHT && commandIndex === stopAt && isDrawCall(call)) {
      const context = gl as WebGL2RenderingContext;
      const originalProgram = context.getParameter(context.CURRENT_PROGRAM) as WebGLProgram | null;
      const wasDepthTestEnabled = context.isEnabled(context.DEPTH_TEST);
      let highlightProgram: WebGLProgram | null = null;
      try {
        highlightProgram = useHighlightShader(context);
        if (highlightProgram) context.disable(context.DEPTH_TEST);
        target[call.name](...args);
      } finally {
        if (wasDepthTestEnabled) context.enable(context.DEPTH_TEST);
        // A frame can inherit its program without recording useProgram.
        // Leave that program usable for the next replay (or resume).
        context.useProgram(originalProgram);
        if (highlightProgram) context.deleteProgram(highlightProgram);
      }
    } else {
      target[call.name](...args);
    }
  });

  const readBuf = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, readBuf);
  const rowBytes = width * 4;
  const flipped = new Uint8ClampedArray(readBuf.length);
  for (let y = 0; y < height; y++) {
    const srcStart = (height - y - 1) * rowBytes; // GL rows are bottom-up, canvas rows are top-down
    flipped.set(readBuf.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
  }
  return makeSnapshot(flipped, width, height);
}

export function isDrawCall(call: GLCall): boolean {
  if (call.name == 'drawArrays' ||
    call.name == 'drawElements' ||
    call.name == 'drawArraysInstanced' ||
    call.name == 'drawElementsInstanced' ||
    call.name == 'drawRangeElements')
    return true;
  else
    return false;
}

// Linking resets program-local state. The override must use the original
// vertex uniforms, including each array element and uniform-block binding.
function copyUniforms(gl: WebGL2RenderingContext, oldProgram: WebGLProgram, newProgram: WebGLProgram): void {
  gl.useProgram(newProgram);
  const count = gl.getProgramParameter(newProgram, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(newProgram, i);
    if (!info) continue;
    for (let element = 0; element < info.size; element++) {
      const arrayIndex = info.name.lastIndexOf('[0]');
      const name = info.size > 1 && arrayIndex >= 0
        ? `${info.name.slice(0, arrayIndex)}[${element}]${info.name.slice(arrayIndex + 3)}`
        : info.name;
      const oldLoc = gl.getUniformLocation(oldProgram, name);
      const newLoc = gl.getUniformLocation(newProgram, name);
      if (oldLoc === null || newLoc === null) continue; // uniform-block members have no location
      const value = gl.getUniform(oldProgram, oldLoc);
      switch (info.type) {
        case gl.FLOAT: gl.uniform1f(newLoc, value); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(newLoc, value); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(newLoc, value); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(newLoc, value); break;
        case gl.INT:
        case gl.BOOL:
        case gl.SAMPLER_2D:
        case gl.SAMPLER_CUBE:
        case gl.SAMPLER_3D:
        case gl.SAMPLER_2D_SHADOW:
        case gl.SAMPLER_2D_ARRAY:
        case gl.SAMPLER_2D_ARRAY_SHADOW:
        case gl.SAMPLER_CUBE_SHADOW:
        case gl.INT_SAMPLER_2D:
        case gl.INT_SAMPLER_3D:
        case gl.INT_SAMPLER_CUBE:
        case gl.INT_SAMPLER_2D_ARRAY:
        case gl.UNSIGNED_INT_SAMPLER_2D:
        case gl.UNSIGNED_INT_SAMPLER_3D:
        case gl.UNSIGNED_INT_SAMPLER_CUBE:
        case gl.UNSIGNED_INT_SAMPLER_2D_ARRAY:
          gl.uniform1i(newLoc, value);
          break;
        case gl.INT_VEC2:
        case gl.BOOL_VEC2: gl.uniform2iv(newLoc, value); break;
        case gl.INT_VEC3:
        case gl.BOOL_VEC3: gl.uniform3iv(newLoc, value); break;
        case gl.INT_VEC4:
        case gl.BOOL_VEC4: gl.uniform4iv(newLoc, value); break;
        case gl.UNSIGNED_INT: gl.uniform1ui(newLoc, value); break;
        case gl.UNSIGNED_INT_VEC2: gl.uniform2uiv(newLoc, value); break;
        case gl.UNSIGNED_INT_VEC3: gl.uniform3uiv(newLoc, value); break;
        case gl.UNSIGNED_INT_VEC4: gl.uniform4uiv(newLoc, value); break;
        case gl.FLOAT_MAT2: gl.uniformMatrix2fv(newLoc, false, value); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(newLoc, false, value); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(newLoc, false, value); break;
        case gl.FLOAT_MAT2x3: gl.uniformMatrix2x3fv(newLoc, false, value); break;
        case gl.FLOAT_MAT2x4: gl.uniformMatrix2x4fv(newLoc, false, value); break;
        case gl.FLOAT_MAT3x2: gl.uniformMatrix3x2fv(newLoc, false, value); break;
        case gl.FLOAT_MAT3x4: gl.uniformMatrix3x4fv(newLoc, false, value); break;
        case gl.FLOAT_MAT4x2: gl.uniformMatrix4x2fv(newLoc, false, value); break;
        case gl.FLOAT_MAT4x3: gl.uniformMatrix4x3fv(newLoc, false, value); break;
      }
    }
  }

  const blockCount = gl.getProgramParameter(newProgram, gl.ACTIVE_UNIFORM_BLOCKS) as number;
  for (let i = 0; i < blockCount; i++) {
    const name = gl.getActiveUniformBlockName(newProgram, i);
    if (name === null) continue;
    // Removing fragment inputs can change block indices; match by name.
    const oldIndex = gl.getUniformBlockIndex(oldProgram, name);
    if (oldIndex === gl.INVALID_INDEX) continue;
    const binding = gl.getActiveUniformBlockParameter(oldProgram, oldIndex, gl.UNIFORM_BLOCK_BINDING) as number;
    gl.uniformBlockBinding(newProgram, i, binding);
  }
}

export function useHighlightShader(gl: WebGL2RenderingContext): WebGLProgram | null {
  const oldProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  if (!oldProgram) return null;
  const vertexShader = gl.getAttachedShaders(oldProgram)?.find(
    shader => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER,
  );
  if (!vertexShader) return null;

  const pixelShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!pixelShader) return null;
  const vertexSource = gl.getShaderSource(vertexShader);
  const isGLES300 = vertexSource?.trimStart().startsWith('#version 300 es') ?? false;
  const pixelSource = isGLES300 ? `#version 300 es
precision mediump float;
layout(location=0) out vec4 fragColor;
void main() {
  fragColor = vec4(1.0, 0.0, 1.0, 1.0);
}` : `
precision mediump float;
void main() {
  gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
}`;

  gl.shaderSource(pixelShader, pixelSource);
  gl.compileShader(pixelShader);
  if (!gl.getShaderParameter(pixelShader, gl.COMPILE_STATUS)) {
    console.error('shader compile failed:', gl.getShaderInfoLog(pixelShader));
    gl.deleteShader(pixelShader);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(pixelShader);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, pixelShader);

  // VAOs refer to attribute locations, which can change when linking.
  const attribCount = gl.getProgramParameter(oldProgram, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < attribCount; i++) {
    const info = gl.getActiveAttrib(oldProgram, i);
    if (!info) continue;
    const location = gl.getAttribLocation(oldProgram, info.name);
    if (location >= 0) gl.bindAttribLocation(program, location, info.name);
  }

  gl.linkProgram(program);
  gl.deleteShader(pixelShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  try {
    copyUniforms(gl, oldProgram, program);
  } catch (error) {
    gl.useProgram(oldProgram);
    gl.deleteProgram(program);
    throw error;
  }
  return program;
}

export enum DRAW_CALL_DEBUG_MODE {
  NONE,
  HIGHLIGHT
}