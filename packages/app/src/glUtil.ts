// glUtils.ts

import { Vec2 } from "@zhobo63/imgui-ts/src/imgui";

export interface RenderTarget {
    size: Vec2;
    texture: WebGLTexture;
    framebuffer: WebGLFramebuffer;
}
export function createRenderTarget(gl: WebGL2RenderingContext, size: Vec2): RenderTarget {
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const previousDrawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousReadFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size.x, size.y, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const frameBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    // FRAMEBUFFER changes both bindings; they may have differed on entry.
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDrawFramebuffer);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousReadFramebuffer);

    return { size: size, texture: texture, framebuffer: frameBuffer };
}
export function destroyRenderTarget(gl: WebGL2RenderingContext, renderTarget: RenderTarget): void {
    // Deletion preserves unrelated bindings and unbinds the deleted resources.
    // Do not bind FRAMEBUFFER here: that would overwrite both read and draw bindings.
    gl.deleteFramebuffer(renderTarget.framebuffer);
    gl.deleteTexture(renderTarget.texture);
}

enum ShaderType {
    Vertex = 0x8B31,
    Fragment = 0x8B30
}
export interface Shader {
    source: string;
    shader: WebGLShader;
}
export function createShader(gl: WebGL2RenderingContext, type: ShaderType, source: string): Shader | null {
    const shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (success) {
        return { source: source, shader: shader };
    }

    console.log(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
}
export function destroyShader(gl: WebGL2RenderingContext, shader: Shader) {
    gl.deleteShader(shader.shader);
}

export interface Program {
    vertexShader: Shader;
    fragmentShader: Shader;
    program: WebGLProgram;
}
export function createProgram(gl: WebGL2RenderingContext, vertexShader: Shader, fragmentShader: Shader): Program | null {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    var success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (success) {
        return { vertexShader: vertexShader, fragmentShader: fragmentShader, program: program };
    }

    console.log(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
}
export function createProgramFromSource(gl: WebGL2RenderingContext, vertexShaderSource: string, fragmentShaderSource: string): Program | null {
    const vertexShader = createShader(gl, ShaderType.Vertex, vertexShaderSource);
    const fragmentShader = createShader(gl, ShaderType.Fragment, fragmentShaderSource);
    if (vertexShader != null && fragmentShader != null) {
        return createProgram(gl, vertexShader, fragmentShader);
    }

    if (vertexShader != null)
        destroyShader(gl, vertexShader);
    if (fragmentShader != null)
        destroyShader(gl, fragmentShader);

    return null;
}
export function destroyProgram(gl: WebGL2RenderingContext, program: Program) {
    gl.deleteProgram(program.program);
}