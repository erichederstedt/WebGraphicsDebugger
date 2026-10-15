import { clipVolumeLines } from './postMesh.js';
import { ImGui, ImGui_Impl } from '@zhobo63/imgui-ts';
import { createProgramFromSource, createRenderTarget, destroyRenderTarget, type Program, type RenderTarget } from './glUtil.js';
import type { CapturedVertexAttributes } from './vertexData.js';

interface MeshViewer {
    gl: WebGL2RenderingContext;
    program: Program;
    vao: WebGLVertexArrayObject;
    buffer: WebGLBuffer;
    boxVao: WebGLVertexArrayObject;
    postVS: boolean;
    target: RenderTarget | null;
    data: CapturedVertexAttributes | null;
    attribute: string;
    center: number[];
    radius: number;
    eye: number[];
    yaw: number;
    pitch: number;
    looking: boolean;
    arcball: boolean;
    orbitDistance: number;
    orbitAxes: number[];
}
const viewers: (MeshViewer | null)[] = [null, null];

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
    v.looking = false;
    v.orbitDistance = v.radius * 3;
    v.orbitAxes = [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function uploadMesh(v: MeshViewer, data: CapturedVertexAttributes, attribute: string): void {
    const values = data.vertexAttributes.get(attribute)!;
    const components = values.length / data.vertexCount;
    const positions = new Float32Array(data.vertexCount * 4);
    const status = data.vertexAttributes.get('_clipStatus');
    const min = v.postVS ? [-1, -1, -1] : [Infinity, Infinity, Infinity];
    const max = v.postVS ? [1, 1, 1] : [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.vertexCount; i++) {
        positions[i * 4 + 3] = status ? status[i] : -1;
        for (let c = 0; c < 3; c++) {
            const value = c < components ? values[i * components + c] : 0;
            positions[i * 4 + c] = value;
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

export function drawMeshViewer(data: CapturedVertexAttributes | null, mode: number, instances: number, postVS = false): void {
    const gl = ImGui_Impl.gl as WebGL2RenderingContext;
    if (data === null || (data.vertexCount === 0 && !postVS)) { ImGui.Text('Select a draw with vertex inputs.'); return; }
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
    if (postVS && data.vertexCount === 0) names[0] = 'NDC position';
    if (!names.length) { ImGui.Text('No vec2, vec3, or vec4 position input is available.'); return; }
    const viewerIndex = postVS ? 1 : 0;
    let viewer = viewers[viewerIndex];
    if (!viewer) {
        const program = createProgramFromSource(gl, `#version 300 es
      layout(location=0) in vec4 position;
      uniform mat4 view; uniform mat4 projection;
      out float status;
      void main() {
        gl_Position = projection * view * vec4(position.xyz, 1);
        gl_PointSize = 4.0;
        status = position.w;
      }`, `#version 300 es
      precision highp float;
      in float status;
      out vec4 color;
      void main() {
        vec3 rgb = gl_FrontFacing ? vec3(0,0,1) : vec3(1,0,0);
        if (status >= 0.0) rgb = vec3(0.35, 0.75, 1.0);
        if (status >= 0.5) rgb = vec3(1.0, 0.3, 0.35);
        if (status >= 1.5) rgb = vec3(1.0, 0.6, 0.15);
        if (status >= 3.5) rgb = vec3(0.1, 1.0, 1.0);
        if (status >= 4.5) rgb = vec3(1.0, 1.0, 0.1);
        if (status >= 5.5) rgb = vec3(1.0);
        color = vec4(rgb, 1);
      }`);
        const vao = gl.createVertexArray()!, buffer = gl.createBuffer()!;
        const oldVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING), oldBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
        const boxVao = gl.createVertexArray()!;
        const boxBuffer = gl.createBuffer();
        gl.bindVertexArray(boxVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, clipVolumeLines(), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
        gl.bindVertexArray(oldVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, oldBuffer);
        viewer = {
            gl, program: program!, vao, buffer, boxVao, postVS,
            target: null, data: null, attribute: '',
            center: [0, 0, 0], radius: 1, eye: [0, 0, 3],
            yaw: 0, pitch: 0, looking: false,
            arcball: false, orbitDistance: 3, orbitAxes: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        };
    }
    viewers[viewerIndex] = viewer;
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
    if (!postVS && ImGui.BeginCombo('Position', attribute)) {
        for (let i = 0; i < names.length; i++) {
            if (ImGui.Selectable(names[i], names[i] === attribute)) attribute = names[i];
        }
        ImGui.EndCombo();
    }
    if (v.data !== data || v.attribute !== attribute) uploadMesh(v, data, attribute);
    if (ImGui.BeginCombo('Camera', v.arcball ? 'Arcball' : 'Free cam')) {
        if (ImGui.Selectable('Free cam', !v.arcball) && v.arcball) {
            v.arcball = false;
            frameMesh(v);
        }
        if (ImGui.Selectable('Arcball', v.arcball) && !v.arcball) {
            v.arcball = true;
            frameMesh(v);
        }
        ImGui.EndCombo();
    }
    if (ImGui.Button('Frame mesh')) uploadMesh(v, data, attribute);
    if (postVS) {
        ImGui.SameLine();
        if (ImGui.Button('Frame clip volume')) {
            v.center = [0, 0, 0]; v.radius = Math.sqrt(3); frameMesh(v);
        }
    }
    ImGui.SameLine();
    if (v.arcball) ImGui.Text('Left-drag: orbit | Scroll: zoom');
    else ImGui.Text('Right-drag: look | WASD + Q/E: move | Shift: faster');
    const available = ImGui.GetContentRegionAvail();
    if (available.x < 1 || available.y < 1) return;
    const io = ImGui.GetIO();
    const width = Math.max(1, Math.floor(available.x * io.DisplayFramebufferScale.x));
    const height = Math.max(1, Math.floor(available.y * io.DisplayFramebufferScale.y));
    if (!v.target || v.target.size.x !== width || v.target.size.y !== height) {
        if (v.target) destroyRenderTarget(gl, v.target);
        v.target = createRenderTarget(gl, { x: width, y: height });
    }
    const imagePosition = ImGui.GetCursorScreenPos();
    ImGui.Image(v.target.texture, available, new ImGui.ImVec2(0, 1), new ImGui.ImVec2(1, 0));
    const hovered = ImGui.IsItemHovered();
    const button = v.arcball ? 0 : 1;
    if (hovered && ImGui.IsMouseClicked(button)) v.looking = true;
    if (!ImGui.IsMouseDown(button)) v.looking = false;
    if (v.arcball) {
        if (v.looking) {
            const mouseX = io.MousePos.x - imagePosition.x;
            const mouseY = io.MousePos.y - imagePosition.y;
            rotateArcball(v.orbitAxes, mouseX - io.MouseDelta.x, mouseY - io.MouseDelta.y,
                mouseX, mouseY, available.x, available.y);
        }
        if (hovered) {
            v.orbitDistance *= Math.exp(-io.MouseWheel * 0.15);
            v.orbitDistance = Math.max(v.radius * 0.01, Math.min(v.radius * 100, v.orbitDistance));
        }
        for (let i = 0; i < 3; i++) {
            v.eye[i] = v.center[i] + v.orbitAxes[6 + i] * v.orbitDistance;
        }
    } else if (v.looking && !io.WantTextInput) {
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
    gl.viewport(0, 0, v.target!.size.x, v.target!.size.y);
    for (let i = 0; i < renderFlags.length; i++) {
        gl.disable(renderFlags[i]);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0.06, 0.08, 0.12, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const z = [Math.sin(v.yaw) * Math.cos(v.pitch), -Math.sin(v.pitch), Math.cos(v.yaw) * Math.cos(v.pitch)];
    const x = [Math.cos(v.yaw), 0, -Math.sin(v.yaw)];
    const y = [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]];
    if (v.arcball) {
        for (let i = 0; i < 3; i++) {
            x[i] = v.orbitAxes[i];
            y[i] = v.orbitAxes[3 + i];
            z[i] = v.orbitAxes[6 + i];
        }
    }
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
    gl.uniformMatrix4fv(gl.getUniformLocation(v.program.program, 'view'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(v.program.program, 'projection'), false, projection);
    for (let i = 0; i < ranges.length; i++) {
        gl.drawArrays(mode, ranges[i].first, ranges[i].count);
    }
    if (v.postVS) {
        // The original camera's bounds remain visible through the inspected mesh.
        gl.disable(gl.DEPTH_TEST);
        gl.bindVertexArray(v.boxVao);
        gl.drawArrays(gl.LINES, 0, 24);
    }
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, old.framebuffer);
    gl.viewport(old.viewport[0], old.viewport[1], old.viewport[2], old.viewport[3]);
    gl.useProgram(old.program);
    gl.bindVertexArray(old.vao);
    gl.clearColor(old.clear[0], old.clear[1], old.clear[2], old.clear[3]);
    gl.clearDepth(old.depthClear);
    gl.depthFunc(old.depthFunc);
    gl.depthMask(old.depthMask);
    gl.colorMask(old.colorMask[0], old.colorMask[1], old.colorMask[2], old.colorMask[3]);
    for (let i = 0; i < renderFlags.length; i++) {
        if (enabled[i]) gl.enable(renderFlags[i]);
        else gl.disable(renderFlags[i]);
    }
}

function arcballPoint(x: number, y: number, width: number, height: number): number[] {
    const scale = Math.min(width, height);
    x = (2 * x - width) / scale;
    y = (height - 2 * y) / scale;
    const lengthSquared = x * x + y * y;
    if (lengthSquared <= 1) return [x, y, Math.sqrt(1 - lengthSquared)];
    const length = Math.sqrt(lengthSquared);
    return [x / length, y / length, 0];
}

export function rotateArcball(axes: number[], oldX: number, oldY: number,
    newX: number, newY: number, width: number, height: number): void {
    const a = arcballPoint(oldX, oldY, width, height);
    const b = arcballPoint(newX, newY, width, height);
    const axis = [b[1] * a[2] - b[2] * a[1], b[2] * a[0] - b[0] * a[2], b[0] * a[1] - b[1] * a[0]];
    let sine = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
    const cosine = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    if (sine < 0.000001) return;
    const worldAxis = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        worldAxis[i] = (axes[i] * axis[0] + axes[3 + i] * axis[1] + axes[6 + i] * axis[2]) / sine;
    }
    // Rodrigues rotation of the camera basis keeps orbiting free of pole clamps.
    for (let column = 0; column < 3; column++) {
        const offset = column * 3;
        const x = axes[offset], y = axes[offset + 1], z = axes[offset + 2];
        const dot = worldAxis[0] * x + worldAxis[1] * y + worldAxis[2] * z;
        axes[offset] = x * cosine + (worldAxis[1] * z - worldAxis[2] * y) * sine + worldAxis[0] * dot * (1 - cosine);
        axes[offset + 1] = y * cosine + (worldAxis[2] * x - worldAxis[0] * z) * sine + worldAxis[1] * dot * (1 - cosine);
        axes[offset + 2] = z * cosine + (worldAxis[0] * y - worldAxis[1] * x) * sine + worldAxis[2] * dot * (1 - cosine);
    }
}
