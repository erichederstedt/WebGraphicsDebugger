import { objectById, type ObjectRegistry } from './objectRegistry.js';
import type { GLCall, SerializedArg } from './types.js';

/** Method names whose execution can change what's visible in the currently bound framebuffer. */
export const FRAMEBUFFER_AFFECTING_METHODS = new Set([
  'clear',
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'drawRangeElements',
  'blitFramebuffer',
]);

/** Reconstructs a real, replayable argument from its serialized form. */
export function toReplayArg(arg: SerializedArg, registry: ObjectRegistry): unknown {
  if (arg.kind === 'globject') {
    const ref = arg.raw as { id: number };
    return objectById(registry, ref.id) ?? null;
  }
  if (arg.kind === 'other') return undefined; // unsupported type; best-effort
  return arg.raw;
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

export function useHighlightShader(gl: WebGL2RenderingContext) {
  const oldProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  if (!oldProgram) return;
  const attachedShaders = gl.getAttachedShaders(oldProgram);
  if (attachedShaders != null) {
    const vertexShader = attachedShaders.find(shader => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER);
    const oldPixelShader = attachedShaders.find(shader => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER);
    if (vertexShader != undefined) {
      const pixelShader = gl.createShader(gl.FRAGMENT_SHADER);
      if (pixelShader != null) {
        const vertexSource = gl.getShaderSource(vertexShader);
        if (oldPixelShader != null) {
          console.log(vertexSource);
          console.log(gl.getShaderSource(oldPixelShader));
        }
        const isGLES300 = vertexSource?.trimStart().startsWith('#version 300 es') ?? false;
        const pixelSource = isGLES300 ? `#version 300 es
        precision highp float;
        out vec4 fragColor;
        void main() {
          fragColor = vec4(1.0, 0.0, 1.0, 1.0);
        }` : `
        precision highp float;
        void main() {
          gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
        }`;

        console.log(pixelSource);

        gl.shaderSource(pixelShader, pixelSource);
        gl.compileShader(pixelShader);
        if (!gl.getShaderParameter(pixelShader, gl.COMPILE_STATUS)) {
          console.error('shader compile failed:', gl.getShaderInfoLog(pixelShader));
          gl.deleteShader(pixelShader);
          return;
        }
        const program = gl.createProgram();

        gl.attachShader(program, vertexShader);
        gl.attachShader(program, pixelShader);

        // A VAO binds vertex attributes by location index, not by name — the
        // linker is free to assign the new program different indices than the
        // original had unless we pin them to match first.
        const attribCount = gl.getProgramParameter(oldProgram, gl.ACTIVE_ATTRIBUTES) as number;
        for (let i = 0; i < attribCount; i++) {
          const info = gl.getActiveAttrib(oldProgram, i);
          if (!info) continue;
          const location = gl.getAttribLocation(oldProgram, info.name);
          if (location >= 0) gl.bindAttribLocation(program, location, info.name);
        }

        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          console.error('program link failed:', gl.getProgramInfoLog(program));
          return;
        }
        gl.useProgram(program);
      }
    }
  }
}

enum DRAW_CALL_DEBUG_MODE {
  NONE,
  HIGHLIGHT
}

/**
 * Re-issues every recorded call against the live `gl` context, which must
 * still hold the same buffers/textures/programs used during capture — true
 * for a paused debug session, since nothing has run since. Calls back after
 * every call that can change the visible framebuffer, so the caller can
 * snapshot it (e.g. for a render-target preview scrubber).
 */
export function replayCalls(gl: object, calls: readonly GLCall[], registry: ObjectRegistry, onFrame: (call: GLCall) => void, debug_mode: DRAW_CALL_DEBUG_MODE = DRAW_CALL_DEBUG_MODE.NONE): void {
  const target = gl as Record<string, (...a: unknown[]) => unknown>;
  var callLength = calls.length;
  while (callLength > 0 && isDrawCall(calls[callLength - 1]) != true) {
    callLength--;
  }
  for (let i = 0; i < callLength; i++) {
    const call = calls[i];
    if (call.threwError) continue; // never happened for real; nothing to replay
    const args = call.args.map((a) => toReplayArg(a, registry));
    try {
      // if (i == (callLength - 1)) useHighlightShader(gl as WebGL2RenderingContext);
      target[call.name](...args);
    } catch {
      // best-effort: skip calls that fail to replay against current live state
    }
    if (FRAMEBUFFER_AFFECTING_METHODS.has(call.name)) onFrame(call);
  }
}
