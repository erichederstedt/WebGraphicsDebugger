import type { GLCall } from '@wgd/core';
import type { CapturedVertexAttributes } from './vertexData.js';
import { copyUniforms } from './programUniforms.js';

export interface PostVertexCapture {
    data: CapturedVertexAttributes;
    unavailable: string[];
}

// GLSL has no API to enumerate vertex outputs. Collect top-level declarations;
// the linker resolves array sizes, types, and inactive preprocessor branches.
export function vertexOutputNames(source: string): string[] {
    const names = ['gl_Position'];
    const tokens = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ').match(/[A-Za-z_]\w*|[^\s]/g)!;
    let braces = 0;
    let parentheses = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === '{') braces++;
        if (token === '}') braces--;
        if (token === '(') parentheses++;
        if (token === ')') parentheses--;
        if (token === 'gl_PointSize') {
            let found = false;
            for (let j = 0; j < names.length; j++) if (names[j] === token) found = true;
            if (!found) names[names.length] = token;
        }
        if (braces !== 0 || parentheses !== 0 || (token !== 'out' && token !== 'varying')) continue;
        i++;
        while (tokens[i] === 'highp' || tokens[i] === 'mediump' || tokens[i] === 'lowp' ||
            tokens[i] === 'flat' || tokens[i] === 'smooth' || tokens[i] === 'centroid' || tokens[i] === 'invariant') i++;
        i++; // type
        let brackets = 0;
        let nameExpected = true;
        for (; i < tokens.length && tokens[i] !== ';'; i++) {
            if (tokens[i] === '[') brackets++;
            if (tokens[i] === ']') brackets--;
            if (brackets !== 0) continue;
            if (nameExpected) {
                const name = tokens[i];
                let found = false;
                for (let j = 0; j < names.length; j++) if (names[j] === name) found = true;
                if (!found) names[names.length] = name;
                nameExpected = false;
            }
            if (tokens[i] === ',') nameExpected = true;
        }
    }
    return names;
}

function outputComponents(gl: WebGL2RenderingContext, type: number): number {
    switch (type) {
        case gl.FLOAT_VEC2: case gl.INT_VEC2: case gl.UNSIGNED_INT_VEC2: return 2;
        case gl.FLOAT_VEC3: case gl.INT_VEC3: case gl.UNSIGNED_INT_VEC3: return 3;
        case gl.FLOAT_VEC4: case gl.INT_VEC4: case gl.UNSIGNED_INT_VEC4: case gl.FLOAT_MAT2: return 4;
        case gl.FLOAT_MAT2x3: case gl.FLOAT_MAT3x2: return 6;
        case gl.FLOAT_MAT2x4: case gl.FLOAT_MAT4x2: return 8;
        case gl.FLOAT_MAT3: return 9;
        case gl.FLOAT_MAT3x4: case gl.FLOAT_MAT4x3: return 12;
        case gl.FLOAT_MAT4: return 16;
        default: return 1;
    }
}

// Called immediately before the selected draw, with its original VAO, textures,
// uniforms, and UBOs bound. No shader source rewriting or camera substitution.
export function capturePostVertexAttributes(gl: WebGL2RenderingContext, call: GLCall,
    args: readonly unknown[], input: CapturedVertexAttributes): PostVertexCapture {
    const data: CapturedVertexAttributes = {
        vertexCount: input.vertexCount, indexCount: input.indexCount,
        indexBuffer: input.indexBuffer, vertexAttributes: new Map(),
    };
    const unavailable: string[] = [];
    if (input.vertexCount === 0) return { data, unavailable };
    const original = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
    const shaders = gl.getAttachedShaders(original)!;
    let names: string[] = ['gl_Position'];
    for (let i = 0; i < shaders.length; i++) {
        if (gl.getShaderParameter(shaders[i], gl.SHADER_TYPE) === gl.VERTEX_SHADER) {
            names = vertexOutputNames(gl.getShaderSource(shaders[i])!);
        }
    }
    // Existing TF declarations also cover outputs named through GLSL macros.
    const originalOutputs = gl.getProgramParameter(original, gl.TRANSFORM_FEEDBACK_VARYINGS);
    for (let i = 0; i < originalOutputs; i++) {
        const name = gl.getTransformFeedbackVarying(original, i)!.name.replace(/\[0\]$/, '');
        let found = false;
        for (let j = 0; j < names.length; j++) if (names[j] === name) found = true;
        if (!found) names[names.length] = name;
    }
    const instances = call.name === 'drawArraysInstanced' ? Number(args[3])
        : call.name === 'drawElementsInstanced' ? Number(args[4]) : 1;
    const vertices: number[] = [];
    if (input.indexBuffer) {
        const restart = Math.pow(2, input.indexBuffer.BYTES_PER_ELEMENT * 8) - 1;
        for (let i = 0; i < input.indexBuffer.length; i++) {
            const index = input.indexBuffer[i];
            if (index !== restart) vertices[vertices.length] = index;
        }
    } else {
        for (let i = 0; i < input.vertexCount / instances; i++) vertices[i] = Number(args[1]) + i;
    }
    let first = vertices[0], last = vertices[0];
    for (let i = 1; i < vertices.length; i++) {
        first = Math.min(first, vertices[i]);
        last = Math.max(last, vertices[i]);
    }
    const count = last - first + 1;
    const previousFeedback = gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING);
    const previousBuffer = gl.getParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING);
    const wasDiscard = gl.isEnabled(gl.RASTERIZER_DISCARD);
    const resumeFeedback = gl.getParameter(gl.TRANSFORM_FEEDBACK_ACTIVE) && !gl.getParameter(gl.TRANSFORM_FEEDBACK_PAUSED);
    if (resumeFeedback) gl.pauseTransformFeedback();
    const feedback = gl.createTransformFeedback();
    const buffer = gl.createBuffer();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
    gl.enable(gl.RASTERIZER_DISCARD);

    // One output per pass avoids the aggregate TF component limit and lets an
    // inactive or unsupported output fail without losing gl_Position.
    for (let output = 0; output < names.length; output++) {
        const program = gl.createProgram()!;
        for (let i = 0; i < shaders.length; i++) gl.attachShader(program, shaders[i]);
        const attributes = gl.getProgramParameter(original, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < attributes; i++) {
            const info = gl.getActiveAttrib(original, i)!;
            const location = gl.getAttribLocation(original, info.name);
            if (location >= 0) gl.bindAttribLocation(program, location, info.name);
        }
        gl.transformFeedbackVaryings(program, [names[output]], gl.INTERLEAVED_ATTRIBS);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            unavailable[unavailable.length] = names[output];
            gl.deleteProgram(program);
            continue;
        }
        const info = gl.getTransformFeedbackVarying(program, 0)!;
        const components = outputComponents(gl, info.type) * info.size;
        copyUniforms(gl, original, program);
        gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buffer);
        gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, count * instances * components * 4, gl.STREAM_READ);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffer);
        gl.beginTransformFeedback(gl.POINTS);
        // WebGL forbids indexed draws during TF. A contiguous vertex range
        // preserves gl_VertexID and gl_InstanceID; gather original indices below.
        gl.drawArraysInstanced(gl.POINTS, first, count, instances);
        gl.endTransformFeedback();
        const bytes = new ArrayBuffer(count * instances * components * 4);
        let values: Float32Array | Int32Array | Uint32Array;
        if (info.type === gl.INT || info.type === gl.INT_VEC2 || info.type === gl.INT_VEC3 || info.type === gl.INT_VEC4) values = new Int32Array(bytes);
        else if (info.type === gl.UNSIGNED_INT || info.type === gl.UNSIGNED_INT_VEC2 || info.type === gl.UNSIGNED_INT_VEC3 || info.type === gl.UNSIGNED_INT_VEC4) values = new Uint32Array(bytes);
        else values = new Float32Array(bytes);
        gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, values);
        const expanded = new Array<number>(input.vertexCount * components);
        for (let instance = 0; instance < instances; instance++) {
            for (let vertex = 0; vertex < vertices.length; vertex++) {
                const source = (instance * count + vertices[vertex] - first) * components;
                const destination = (instance * vertices.length + vertex) * components;
                for (let c = 0; c < components; c++) expanded[destination + c] = values[source + c];
            }
        }
        data.vertexAttributes.set(names[output], expanded);
        gl.useProgram(original);
        gl.deleteProgram(program);
    }
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, previousFeedback);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, previousBuffer);
    gl.useProgram(original);
    if (!wasDiscard) gl.disable(gl.RASTERIZER_DISCARD);
    if (resumeFeedback) gl.resumeTransformFeedback();
    gl.deleteTransformFeedback(feedback);
    gl.deleteBuffer(buffer);
    return { data, unavailable };
}
