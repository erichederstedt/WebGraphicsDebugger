import { ImGui, ImGui_Impl } from '@zhobo63/imgui-ts';
import { createProgramFromSource, createRenderTarget, destroyRenderTarget, type Program, type RenderTarget } from './glUtil.js';
import type { CapturedVertexAttributes } from './vertexData.js';

interface MeshViewer {
  gl: WebGL2RenderingContext;
  program: Program;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  target: RenderTarget | null;
  data: CapturedVertexAttributes | null;
  attribute: string;
  center: number[];
  radius: number;
  eye: number[];
  yaw: number;
  pitch: number;
  looking: boolean;
}
let viewer: MeshViewer | null = null;

// Captured attributes are already expanded. Restart markers and instances still
// separate primitive sequences, particularly for strips, fans, and line loops.
export function meshDrawRanges(data: CapturedVertexAttributes, instances: number): { first: number; count: number }[] {
  if (instances <= 0) return [];
  const lengths: number[] = [];
  if (data.indexBuffer) {
    const restart = 2 ** (data.indexBuffer.BYTES_PER_ELEMENT * 8) - 1;
    let count = 0;
    for (let i = 0; i < data.indexBuffer.length; i++) {
      const index = data.indexBuffer[i];
      if (index === restart) { lengths[lengths.length] = count; count = 0; }
      else count++;
    }
    lengths[lengths.length] = count;
  } else lengths[lengths.length] = data.vertexCount / instances;
  const ranges: { first: number; count: number }[] = [];
  let first = 0;
  for (let instance = 0; instance < instances; instance++) {
    for (let i = 0; i < lengths.length; i++) {
      const count = lengths[i];
      if (count) ranges[ranges.length] = { first: first, count: count };
      first += count;
    }
  }
  return ranges;
}

function frameMesh(v: MeshViewer): void {
  v.eye = [v.center[0], v.center[1], v.center[2] + v.radius * 3];
  v.yaw = 0;
  v.pitch = 0;
}

function uploadMesh(v: MeshViewer, data: CapturedVertexAttributes, attribute: string): void {
  const values = data.vertexAttributes.get(attribute)!;
  const components = values.length / data.vertexCount;
  const positions = new Float32Array(data.vertexCount * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < data.vertexCount; i++) {
    for (let c = 0; c < 3; c++) {
      const value = c < components ? values[i * components + c] : 0;
      positions[i * 3 + c] = value;
      min[c] = Math.min(min[c], value);
      max[c] = Math.max(max[c], value);
    }
  }
  const gl = v.gl;
  const oldBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  gl.bindBuffer(gl.ARRAY_BUFFER, v.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, oldBuffer);
  let diagonalSquared = 0;
  for (let i = 0; i < 3; i++) {
    v.center[i] = (min[i] + max[i]) / 2;
    const extent = max[i] - min[i];
    diagonalSquared += extent * extent;
  }
  v.radius = Math.max(0.001, Math.sqrt(diagonalSquared) / 2);
  v.data = data;
  v.attribute = attribute;
  frameMesh(v);
}

export function drawMeshViewer(data: CapturedVertexAttributes | null, mode: number, instances: number): void {
  const gl = ImGui_Impl.gl as WebGL2RenderingContext;
  if (data === null || data.vertexCount === 0) { ImGui.Text('Select a draw with vertex inputs.'); return; }
  const names: string[] = [];
  const attributes = data.vertexAttributes.entries();
  let entry = attributes.next();
  while (!entry.done) {
    const name = entry.value[0];
    const values = entry.value[1];
    const components = values.length / data.vertexCount;
    if (components >= 2 && components <= 4 && components % 1 === 0) {
      names[names.length] = name;
    }
    entry = attributes.next();
  }
  if (!names.length) { ImGui.Text('No vec2, vec3, or vec4 position input is available.'); return; }
  if (!viewer) {
    const program = createProgramFromSource(gl, `#version 300 es
      layout(location=0) in vec3 position;
      uniform mat4 view; uniform mat4 projection;
      void main() { gl_Position=projection*view*vec4(position,1); gl_PointSize=4.0; }`, `#version 300 es
      precision highp float;
      out vec4 color;
      void main() { color=vec4(gl_FrontFacing ? vec3(0.9,0.45,0.65) : vec3(0.45,0.65,0.9),1); }`);
    const vao = gl.createVertexArray()!, buffer = gl.createBuffer()!;
    const oldVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING), oldBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(oldVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, oldBuffer);
    viewer = {
      gl, program: program!, vao, buffer,
      target: null, data: null, attribute: '',
      center: [0, 0, 0], radius: 1, eye: [0, 0, 3],
      yaw: 0, pitch: 0, looking: false,
    };
  }
  const v = viewer;
  let attribute = names[0];
  for (let i = 0; i < names.length; i++) {
    if (names[i].toLowerCase().indexOf('pos') >= 0) {
      attribute = names[i];
      break;
    }
  }
  for (let i = 0; i < names.length; i++) {
    if (names[i] === v.attribute) {
      attribute = names[i];
      break;
    }
  }
  if (ImGui.BeginCombo('Position', attribute)) {
    for (let i = 0; i < names.length; i++) {
      if (ImGui.Selectable(names[i], names[i] === attribute)) attribute = names[i];
    }
    ImGui.EndCombo();
  }
  if (v.data !== data || v.attribute !== attribute) uploadMesh(v, data, attribute);
  if (ImGui.Button('Frame mesh')) frameMesh(v);
  ImGui.SameLine();
  ImGui.Text('Right-drag: look | WASD + Q/E: move | Shift: faster');
  const available = ImGui.GetContentRegionAvail();
  if (available.x < 1 || available.y < 1) return;
  const io = ImGui.GetIO();
  const width = Math.max(1, Math.floor(available.x * io.DisplayFramebufferScale.x));
  const height = Math.max(1, Math.floor(available.y * io.DisplayFramebufferScale.y));
  if (!v.target || v.target.size.x !== width || v.target.size.y !== height) {
    if (v.target) destroyRenderTarget(gl, v.target);
    v.target = createRenderTarget(gl, { x: width, y: height });
  }
  ImGui.Image(v.target.texture, available, new ImGui.ImVec2(0,1), new ImGui.ImVec2(1,0));
  if (ImGui.IsItemHovered() && ImGui.IsMouseClicked(1)) v.looking = true;
  if (!ImGui.IsMouseDown(1)) v.looking = false;
  if (v.looking && !io.WantTextInput) {
    v.yaw -= io.MouseDelta.x * 0.005;
    v.pitch = Math.max(-1.55, Math.min(1.55, v.pitch - io.MouseDelta.y * 0.005));
    const step = v.radius * Math.min(io.DeltaTime, 0.1) * (io.KeyShift ? 4 : 1);
    let forward = 0;
    let right = 0;
    let up = 0;
    if (io.KeysDown[87] || io.KeysDown[119]) forward += step; // W
    if (io.KeysDown[83] || io.KeysDown[115]) forward -= step; // S
    if (io.KeysDown[68] || io.KeysDown[100]) right += step;   // D
    if (io.KeysDown[65] || io.KeysDown[97]) right -= step;    // A
    if (io.KeysDown[69] || io.KeysDown[101]) up += step;      // E
    if (io.KeysDown[81] || io.KeysDown[113]) up -= step;      // Q
    v.eye[0] += -Math.sin(v.yaw) * Math.cos(v.pitch) * forward + Math.cos(v.yaw) * right;
    v.eye[1] += Math.sin(v.pitch) * forward + up;
    v.eye[2] += -Math.cos(v.yaw) * Math.cos(v.pitch) * forward - Math.sin(v.yaw) * right;
  }
  renderMesh(v, mode, meshDrawRanges(data, instances));
}

function renderMesh(v: MeshViewer, mode: number, ranges: { first: number; count: number }[]): void {
  const gl = v.gl;
  const old = {
    framebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), viewport: gl.getParameter(gl.VIEWPORT),
    program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING),
    clear: gl.getParameter(gl.COLOR_CLEAR_VALUE), depthClear: gl.getParameter(gl.DEPTH_CLEAR_VALUE),
    depthFunc: gl.getParameter(gl.DEPTH_FUNC), depthMask: gl.getParameter(gl.DEPTH_WRITEMASK), colorMask: gl.getParameter(gl.COLOR_WRITEMASK),
  };
  const renderFlags = [gl.SCISSOR_TEST, gl.BLEND, gl.CULL_FACE, gl.DEPTH_TEST];
  const enabled: boolean[] = [];
  for (let i = 0; i < renderFlags.length; i++) {
    enabled[i] = gl.isEnabled(renderFlags[i]);
  }
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, v.target!.framebuffer);
  gl.viewport(0,0,v.target!.size.x,v.target!.size.y);
  for (let i = 0; i < renderFlags.length; i++) {
    gl.disable(renderFlags[i]);
  }
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(true);
  gl.colorMask(true,true,true,true);
  gl.clearColor(0.06,0.08,0.12,1);
  gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const z = [Math.sin(v.yaw)*Math.cos(v.pitch), -Math.sin(v.pitch), Math.cos(v.yaw)*Math.cos(v.pitch)];
  const x = [Math.cos(v.yaw),0,-Math.sin(v.yaw)];
  const y = [z[1]*x[2],z[2]*x[0]-z[0]*x[2],-z[1]*x[0]];
  const translation = [0, 0, 0];
  let distanceSquared = 0;
  for (let i = 0; i < 3; i++) {
    translation[0] -= x[i] * v.eye[i];
    translation[1] -= y[i] * v.eye[i];
    translation[2] -= z[i] * v.eye[i];
    const delta = v.eye[i] - v.center[i];
    distanceSquared += delta * delta;
  }
  const view = new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    translation[0], translation[1], translation[2], 1,
  ]);
  const near = v.radius * 0.001;
  const distance = Math.sqrt(distanceSquared);
  const far = Math.max(v.radius * 100, distance + v.radius * 2);
  const f = 1 / Math.tan(Math.PI / 8);
  const projection = new Float32Array([
    f * v.target!.size.y / v.target!.size.x, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, 2 * far * near / (near - far), 0,
  ]);
  gl.useProgram(v.program.program);
  gl.bindVertexArray(v.vao);
  gl.uniformMatrix4fv(gl.getUniformLocation(v.program.program,'view'),false,view);
  gl.uniformMatrix4fv(gl.getUniformLocation(v.program.program,'projection'),false,projection);
  for (let i = 0; i < ranges.length; i++) {
    gl.drawArrays(mode, ranges[i].first, ranges[i].count);
  }
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,old.framebuffer);
  gl.viewport(old.viewport[0],old.viewport[1],old.viewport[2],old.viewport[3]);
  gl.useProgram(old.program);
  gl.bindVertexArray(old.vao);
  gl.clearColor(old.clear[0],old.clear[1],old.clear[2],old.clear[3]);
  gl.clearDepth(old.depthClear);
  gl.depthFunc(old.depthFunc);
  gl.depthMask(old.depthMask);
  gl.colorMask(old.colorMask[0], old.colorMask[1], old.colorMask[2], old.colorMask[3]);
  for (let i = 0; i < renderFlags.length; i++) {
    if (enabled[i]) gl.enable(renderFlags[i]);
    else gl.disable(renderFlags[i]);
  }
}
