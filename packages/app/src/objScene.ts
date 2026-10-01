import { compileShader, type DemoScene } from './demoScene.js';
import { parseObj, parseMtl, type ObjMesh, type ObjMaterial } from './objLoader.js';

export interface ObjCamera {
  target: [number, number, number];
  distance: number;
  yaw: number;
  pitch: number;
}

type ReadAsset = (path: string) => Promise<Blob>;

export async function loadObjScene(canvas: HTMLCanvasElement, url: string, signal: AbortSignal, camera?: ObjCamera): Promise<DemoScene> {
  const absolute = new URL(url, document.baseURI).href;
  return loadAssets(canvas, absolute, async path => {
    const response = await fetch(path, { signal });
    if (!response.ok) throw new Error(`Could not load ${path}: HTTP ${response.status}`);
    return response.blob();
  }, signal, camera);
}

export async function loadObjFiles(canvas: HTMLCanvasElement, files: File[], signal: AbortSignal): Promise<DemoScene> {
  const objs = files.filter(file => /\.obj$/i.test(file.name));
  if (objs.length !== 1) throw new Error('Select one OBJ together with its MTL and texture files.');
  const root = 'https://local-obj.invalid/';
  const path = (file: File) => file.webkitRelativePath || file.name;
  return loadAssets(canvas, new URL(path(objs[0]), root).href, async url => {
    const requested = decodeURIComponent(new URL(url).pathname).slice(1).toLowerCase();
    let file = files.find(file => path(file).replace(/\\/g, '/').toLowerCase() === requested);
    if (!file) {
      const matches = files.filter(file => file.name.toLowerCase() === requested.split('/').pop());
      if (matches.length === 1) file = matches[0];
    }
    if (!file) throw new Error(`Missing OBJ asset: ${requested}. Include its MTL and textures when opening the model.`);
    return file;
  }, signal);
}

async function loadAssets(canvas: HTMLCanvasElement, objUrl: string, read: ReadAsset, signal: AbortSignal, camera?: ObjCamera): Promise<DemoScene> {
  const mesh = parseObj(await (await read(objUrl)).text());
  const materials = new Map<string, ObjMaterial>();
  const images = new Map<string, ImageBitmap>();
  try {
    for (const library of mesh.materialLibraries) {
      const url = new URL(library.replace(/\\/g, '/'), objUrl).href;
      for (const [name, material] of parseMtl(await (await read(url)).text())) {
        if (material.texture) material.texture = new URL(material.texture, url).href;
        materials.set(name, material);
      }
    }
    for (const part of mesh.parts) {
      const texture = materials.get(part.material)?.texture;
      if (texture && !images.has(texture)) {
        signal.throwIfAborted();
        images.set(texture, await createImageBitmap(await read(texture), { imageOrientation: 'flipY' }));
      }
    }
    signal.throwIfAborted();
    // Finish asynchronous IO before touching the shared WebGL context.
    return createObjScene(canvas, mesh, materials, images, camera);
  } finally {
    for (const image of images.values()) image.close();
  }
}

function createObjScene(canvas: HTMLCanvasElement, mesh: ObjMesh, materials: Map<string, ObjMaterial>, images: Map<string, ImageBitmap>, camera?: ObjCamera): DemoScene {
  const context = canvas.getContext('webgl2');
  if (!context) throw new Error('WebGL2 is not available.');
  const gl: WebGL2RenderingContext = context;
  const program = gl.createProgram()!;
  const shaders = [
    compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
      layout(location=0) in vec3 a_position;
      layout(location=1) in vec3 a_normal;
      layout(location=2) in vec2 a_uv;
      uniform mat4 u_view;
      uniform mat4 u_projection;
      out vec3 v_normal;
      out vec2 v_uv;
      void main() { gl_Position=u_projection*u_view*vec4(a_position,1); v_normal=a_normal; v_uv=a_uv; }`),
    compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      in vec3 v_normal;
      in vec2 v_uv;
      uniform sampler2D u_texture;
      uniform vec3 u_color;
      out vec4 outColor;
      void main() {
        vec3 normal=normalize(v_normal);
        if (!gl_FrontFacing) normal=-normal;
        float light=0.45+0.55*max(dot(normal,normalize(vec3(0.4,1,0.3))),0.0);
        outColor=vec4(texture(u_texture,v_uv).rgb*u_color*light,1);
      }`),
  ];
  for (const shader of shaders) gl.attachShader(program, shader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'OBJ shader link failed.');
  const vao = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  for (const [location, size, offset] of [[0, 3, 0], [1, 3, 12], [2, 2, 24]]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
  }
  const textures = new Map<string, WebGLTexture>();
  gl.activeTexture(gl.TEXTURE0);
  for (const key of ['', ...images.keys()]) {
    const texture = gl.createTexture()!;
    textures.set(key, texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const image = images.get(key);
    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const viewLoc = gl.getUniformLocation(program, 'u_view'), projectionLoc = gl.getUniformLocation(program, 'u_projection');
  const colorLoc = gl.getUniformLocation(program, 'u_color'), textureLoc = gl.getUniformLocation(program, 'u_texture');
  const center = camera?.target ?? mesh.min.map((v, i) => (v + mesh.max[i]) / 2);
  const radius = Math.max(0.01, Math.hypot(...mesh.max.map((v, i) => v - mesh.min[i])) / 2);
  let distance = camera?.distance ?? radius * 2.6;
  let yaw = camera?.yaw ?? 0.8, pitch = camera?.pitch ?? 0.55;
  let dragging = false, previousX = 0, previousY = 0;
  const originalTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    dragging = true; previousX = event.clientX; previousY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!dragging) return;
    yaw -= (event.clientX - previousX) * 0.008;
    pitch = Math.max(-1.5, Math.min(1.5, pitch + (event.clientY - previousY) * 0.008));
    previousX = event.clientX; previousY = event.clientY;
  };
  const up = () => { dragging = false; };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    distance = Math.max(radius * 0.03, Math.min(radius * 10, distance * Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * 0.002)));
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  const view = new Float32Array(16), projection = new Float32Array(16);
  return {
    gl,
    drawFrame() {
      const z = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
      const x = [Math.cos(yaw), 0, -Math.sin(yaw)];
      const y = [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]];
      const eye = center.map((v, i) => v + z[i] * distance);
      const dot = (v: number[]) => v.reduce((sum, n, i) => sum + n * eye[i], 0);
      view.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x), -dot(y), -dot(z), 1]);
      const near = radius * 0.001, far = radius * 20, f = 1 / Math.tan(Math.PI / 8);
      projection.set([f / (canvas.width / canvas.height), 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.clearColor(0.08, 0.08, 0.1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program); gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(viewLoc, false, view);
      gl.uniformMatrix4fv(projectionLoc, false, projection);
      gl.activeTexture(gl.TEXTURE0); gl.uniform1i(textureLoc, 0);
      for (const part of mesh.parts) {
        const material = materials.get(part.material);
        gl.uniform3fv(colorLoc, material?.color ?? [1, 1, 1]);
        gl.bindTexture(gl.TEXTURE_2D, textures.get(material?.texture ?? '')!);
        gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, part.firstIndex * 4);
      }
    },
    dispose() {
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel); canvas.style.touchAction = originalTouchAction;
      gl.deleteVertexArray(vao); gl.deleteBuffer(vertexBuffer); gl.deleteBuffer(indexBuffer);
      gl.deleteProgram(program);
      for (const shader of shaders) gl.deleteShader(shader);
      for (const texture of textures.values()) gl.deleteTexture(texture);
    },
  };
}
