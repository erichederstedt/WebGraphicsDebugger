import { afterAll, beforeAll, expect, it } from 'vitest';
import { firefox, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

let display: ChildProcess;
let browser: Browser;
let page: Page;
beforeAll(async () => {
  display = spawn('Xvfb', [':97', '-screen', '0', '64x64x24'], { stdio: 'ignore' });
  await new Promise(resolve => setTimeout(resolve, 1000));
  browser = await firefox.launch({ headless: false, env: { ...process.env, DISPLAY: ':97', LIBGL_ALWAYS_SOFTWARE: '1' } });
  page = await browser.newPage();
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/postVertexEntry.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'PostVertex',
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}, 30_000);
afterAll(async () => {
  await browser?.close();
  display?.kill();
});

it('captures actual shader outputs with indices, instances, uniforms, UBOs, and vertex texture fetches', async () => {
    const result = await page.evaluate(() => {
        const api = (window as unknown as { PostVertex: typeof import('./fixtures/postVertexEntry.js') }).PostVertex;
        const gl = document.createElement('canvas').getContext('webgl2')!;
        const program = gl.createProgram()!;
        const sources = [
            `#version 300 es
            layout(location=3) in vec2 position;
            layout(location=5) in float instanceOffset;
            uniform float scale;
            uniform sampler2D vertexTexture;
            layout(std140) uniform Offset { vec4 offset; };
            out vec2 uv;
            flat out uvec2 ids;
            out mat2 basis;
            out float weights[2];
            #if 0
            out vec3 disabledOutput;
            #endif
            void helper(out float x) { x = 1.0; }
            void main() {
                gl_Position = vec4(position * scale + offset.xy + vec2(instanceOffset, 0), float(gl_VertexID), 2.0);
                gl_Position.x += texelFetch(vertexTexture, ivec2(0), 0).r;
                uv = position;
                ids = uvec2(gl_VertexID, gl_InstanceID);
                basis = mat2(1,2,3,4);
                weights[0] = 0.25; weights[1] = 0.75;
            }`,
            `#version 300 es
            precision highp float;
            in vec2 uv;
            flat in uvec2 ids;
            in mat2 basis;
            in float weights[2];
            out vec4 color;
            void main() { color=vec4(uv + vec2(ids) + basis[0] + weights[0] + weights[1],0,1); }`,
        ];
        for (let i = 0; i < 2; i++) {
            const shader = gl.createShader(i === 0 ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER)!;
            gl.shaderSource(shader, sources[i]); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader)!);
            gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program)!);
        gl.useProgram(program);
        gl.uniform1f(gl.getUniformLocation(program, 'scale'), 2);
        gl.uniform1i(gl.getUniformLocation(program, 'vertexTexture'), 2);
        gl.activeTexture(gl.TEXTURE2);
        const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,0,0,255]));
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
        const ubo = gl.createBuffer(); gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
        gl.bufferData(gl.UNIFORM_BUFFER,new Float32Array([10,20,0,0]),gl.STATIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER,4,ubo);
        gl.uniformBlockBinding(program,gl.getUniformBlockIndex(program,'Offset'),4);
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0, 1,2, 3,4, 5,6]),gl.STATIC_DRAW);
        gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,2,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([100,200]),gl.STATIC_DRAW);
        gl.enableVertexAttribArray(5);gl.vertexAttribPointer(5,1,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(5,2);
        const ebo = gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([99,3,1,3,65535,2]),gl.STATIC_DRAW);
        const tf = gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);
        const oldTfBuffer = gl.createBuffer();gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,oldTfBuffer);
        gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,64,gl.STREAM_READ);
        const call = { id:0, name:'drawElementsInstanced',args:[],result:undefined,timestamp:0 };
        const args = [gl.TRIANGLE_STRIP,5,gl.UNSIGNED_SHORT,2,3];
        const input = api.captureVertexAttributes(gl,call,args);
        const output = api.capturePostVertexAttributes(gl,call,args,input);
        const arraysCall = { ...call, name:'drawArrays' };
        const arrayArgs = [gl.POINTS,2,2];
        const arrayInput = api.captureVertexAttributes(gl,arraysCall,arrayArgs);
        const arrays = api.capturePostVertexAttributes(gl,arraysCall,arrayArgs,arrayInput);
        return {
            values: Object.fromEntries(output.data.vertexAttributes), unavailable: output.unavailable,
            arrays: arrays.data.vertexAttributes.get('ids'),
            count: output.data.vertexCount,
            indices: Array.from(output.data.indexBuffer!),
            restored: gl.getParameter(gl.CURRENT_PROGRAM) === program && gl.getParameter(gl.VERTEX_ARRAY_BINDING) === vao
                && gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING) === tf
                && gl.getParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING) === oldTfBuffer
                && gl.getIndexedParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING,0) === oldTfBuffer
                && gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) === ebo
                && gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE2
                && gl.getParameter(gl.TEXTURE_BINDING_2D) === texture
                && !gl.isEnabled(gl.RASTERIZER_DISCARD),
            error: gl.getError(),
        };
    });
    expect(result.error).toBe(0);
    expect(result.restored).toBe(true);
    expect(result.count).toBe(12);
    expect(result.indices).toEqual([3,1,3,65535,2]);
    expect(result.values.ids).toEqual([3,0,1,0,3,0,2,0, 3,1,1,1,3,1,2,1, 3,2,1,2,3,2,2,2]);
    expect(result.arrays).toEqual([2,0,3,0]);
    expect(result.values.gl_Position.slice(0,16)).toEqual([121,32,3,2, 113,24,1,2, 121,32,3,2, 117,28,2,2]);
    expect(result.values.gl_Position.slice(32,36)).toEqual([221,32,3,2]);
    expect(result.values.uv.slice(0,8)).toEqual([5,6,1,2,5,6,3,4]);
    expect(result.values.basis.slice(0,4)).toEqual([1,2,3,4]);
    expect(result.values.weights.slice(0,2)).toEqual([0.25,0.75]);
    expect(result.unavailable).toEqual(['disabledOutput']);
});

it('captures GLSL ES 1.00 vertex outputs in a WebGL2 context', async () => {
    const result = await page.evaluate(() => {
        const api = (window as unknown as { PostVertex: typeof import('./fixtures/postVertexEntry.js') }).PostVertex;
        const gl = document.createElement('canvas').getContext('webgl2')!;
        const program = gl.createProgram()!;
        const vertex = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vertex,'attribute vec2 position; varying vec2 uv; void main(){gl_Position=vec4(position,0,1); uv=position;}');
        gl.compileShader(vertex);gl.attachShader(program,vertex);
        const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fragment,'precision mediump float; varying vec2 uv; void main(){gl_FragColor=vec4(uv,0,1);}');
        gl.compileShader(fragment);gl.attachShader(program,fragment);gl.linkProgram(program);gl.useProgram(program);
        const location = gl.getAttribLocation(program,'position');
        gl.vertexAttrib2f(location,2,3);
        const call={id:0,name:'drawArrays',args:[],result:undefined,timestamp:0};
        const args=[gl.POINTS,0,1];
        const input=api.captureVertexAttributes(gl,call,args);
        const output=api.capturePostVertexAttributes(gl,call,args,input);
        return {values:Object.fromEntries(output.data.vertexAttributes),unavailable:output.unavailable,error:gl.getError()};
    });
    expect(result.error).toBe(0);
    expect(result.unavailable).toEqual([]);
    expect(result.values).toEqual({gl_Position:[2,3,0,1],uv:[2,3]});
});

it('preserves an active transform-feedback session and its buffer contents', async () => {
    const result=await page.evaluate(()=>{
        const api=(window as unknown as {PostVertex:typeof import('./fixtures/postVertexEntry.js')}).PostVertex;
        const gl=document.createElement('canvas').getContext('webgl2')!;
        const program=gl.createProgram()!;
        const vertex=gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vertex,'#version 300 es\nout float value; void main(){value=float(gl_VertexID);gl_Position=vec4(0,0,0,1);}');
        gl.compileShader(vertex);gl.attachShader(program,vertex);
        const fragment=gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fragment,'#version 300 es\nprecision mediump float;out vec4 color;void main(){color=vec4(1);}');
        gl.compileShader(fragment);gl.attachShader(program,fragment);
        gl.transformFeedbackVaryings(program,['value'],gl.INTERLEAVED_ATTRIBS);
        gl.linkProgram(program);gl.useProgram(program);
        const tf=gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,tf);
        const buffer=gl.createBuffer();gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,buffer);
        gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,8,gl.STREAM_READ);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,buffer);
        gl.enable(gl.RASTERIZER_DISCARD);
        const call={id:0,name:'drawArrays',args:[],result:undefined,timestamp:0};
        const args=[gl.POINTS,2,2];
        const input=api.captureVertexAttributes(gl,call,args);
        gl.beginTransformFeedback(gl.POINTS);
        const output=api.capturePostVertexAttributes(gl,call,args,input);
        const active=gl.getParameter(gl.TRANSFORM_FEEDBACK_ACTIVE) && !gl.getParameter(gl.TRANSFORM_FEEDBACK_PAUSED);
        gl.drawArrays(gl.POINTS,2,2);gl.endTransformFeedback();
        const values=new Float32Array(2);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,values);
        return {values:Array.from(values),captured:output.data.vertexAttributes.get('value'),active,
            discard:gl.isEnabled(gl.RASTERIZER_DISCARD),error:gl.getError()};
    });
    expect(result).toEqual({values:[2,3],captured:[2,3],active:true,discard:true,error:0});
});
