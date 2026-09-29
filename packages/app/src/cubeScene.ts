import { compileShader, type DemoScene } from './demoScene.js';

const VERTEX_SRC = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec3 a_color;
uniform mat4 u_rotation;
uniform mat4 u_projection;
out vec3 v_normal;
out vec3 v_color;
void main() {
  vec4 position = u_rotation * vec4(a_position, 1.0);
  position.z -= 5.0;
  gl_Position = u_projection * position;
  v_normal = mat3(u_rotation) * a_normal;
  v_color = a_color;
}`;

const FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec3 v_normal;
in vec3 v_color;
out vec4 outColor;
void main() {
  float light = 0.3 + 0.7 * max(dot(normalize(v_normal), normalize(vec3(0.5, 0.8, 1.0))), 0.0);
  outColor = vec4(v_color * light, 1.0);
}`;

export function createCubeScene(canvas: HTMLCanvasElement): DemoScene {
  const context = canvas.getContext('webgl2');
  if (!context) throw new Error('WebGL2 is not available in this browser.');
  const gl: WebGL2RenderingContext = context;
  const program = gl.createProgram()!;
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Cube program failed to link.');

  // Separate face vertices preserve hard normals and distinct face colors.
  const faces = [
    { normal: [0, 0, 1], color: [1, 0.3, 0.3], positions: [-1,-1,1, 1,-1,1, 1,1,1, -1,1,1] },
    { normal: [0, 0, -1], color: [0.3, 0.8, 1], positions: [1,-1,-1, -1,-1,-1, -1,1,-1, 1,1,-1] },
    { normal: [1, 0, 0], color: [0.4, 1, 0.4], positions: [1,-1,1, 1,-1,-1, 1,1,-1, 1,1,1] },
    { normal: [-1, 0, 0], color: [1, 0.7, 0.2], positions: [-1,-1,-1, -1,-1,1, -1,1,1, -1,1,-1] },
    { normal: [0, 1, 0], color: [0.6, 0.4, 1], positions: [-1,1,1, 1,1,1, 1,1,-1, -1,1,-1] },
    { normal: [0, -1, 0], color: [0.3, 1, 1], positions: [-1,-1,-1, 1,-1,-1, 1,-1,1, -1,-1,1] },
  ];
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let face = 0; face < faces.length; face++) {
    const { positions, normal, color } = faces[face];
    for (let vertex = 0; vertex < 4; vertex++) vertices.push(...positions.slice(vertex * 3, vertex * 3 + 3), ...normal, ...color);
    const first = face * 4;
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  for (const [attribute, offset] of [['a_position', 0], ['a_normal', 3], ['a_color', 6]] as const) {
    const location = gl.getAttribLocation(program, attribute);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 9 * 4, offset * 4);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const rotationLoc = gl.getUniformLocation(program, 'u_rotation');
  const projectionLoc = gl.getUniformLocation(program, 'u_projection');
  const rotation = new Float32Array(16);
  const projection = new Float32Array(16);

  function drawFrame(timeMs: number): void {
    const x = timeMs * 0.0004;
    const y = timeMs * 0.0007;
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y);
    // Column-major rotation around Y followed by the local X rotation.
    rotation.set([cy, 0, -sy, 0, sy * sx, cx, cy * sx, 0, sy * cx, -sx, cy * cx, 0, 0, 0, 0, 1]);
    const near = 0.1, far = 100;
    const f = 1 / Math.tan(Math.PI / 8);
    projection.set([f / (canvas.width / canvas.height), 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(0.08, 0.08, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(rotationLoc, false, rotation);
    gl.uniformMatrix4fv(projectionLoc, false, projection);
    // One indexed draw per face gives the inspector several draws to select.
    for (let face = 0; face < 6; face++) gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, face * 6 * 2);
  }
  return { gl, drawFrame };
}
