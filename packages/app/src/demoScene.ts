const VERTEX_SRC = `#version 300 es
uniform mat2 u_rotation;
in vec2 a_position;
in vec3 a_color;
out vec3 v_color;
void main() {
  vec2 rotated = u_rotation * a_position;
  gl_Position = vec4(rotated, 0.0, 1.0);
  v_color = a_color;
}
`;

const FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec3 v_color;
uniform sampler2D u_tint;
out vec4 outColor;
void main() {
  vec4 tint = texture(u_tint, vec2(0.5, 0.5));
  outColor = vec4(v_color * tint.rgb, 1.0);
}
`;

// interleaved x, y, r, g, b per vertex
const VERTEX_DATA = new Float32Array([
  0.0, 0.6, 1, 0.3, 0.3,
  -0.6, -0.5, 0.3, 1, 0.3,
  0.6, -0.5, 0.3, 0.3, 1,
]);

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export interface DemoScene {
  gl: WebGL2RenderingContext;
  drawFrame: (timeMs: number) => void;
}

export function createDemoScene(canvas: HTMLCanvasElement): DemoScene {
  const ctx = canvas.getContext('webgl2');
  if (!ctx) throw new Error('WebGL2 is not available in this browser.');
  const gl: WebGL2RenderingContext = ctx;

  const program = gl.createProgram()!;
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, VERTEX_DATA, gl.STATIC_DRAW);

  const positionLoc = gl.getAttribLocation(program, 'a_position');
  const colorLoc = gl.getAttribLocation(program, 'a_color');
  const stride = 5 * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(colorLoc);
  gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const rotationLoc = gl.getUniformLocation(program, 'u_rotation');
  const tintLoc = gl.getUniformLocation(program, 'u_tint');

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.08, 0.08, 0.1, 1);
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  function drawFrame(timeMs: number) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    const angle = timeMs * 0.001;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    gl.uniformMatrix2fv(rotationLoc, false, [c, s, -s, c]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(tintLoc, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return { gl, drawFrame };
}
