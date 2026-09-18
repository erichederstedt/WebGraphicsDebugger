import { objectById, type ObjectRegistry } from './objectRegistry.js';
import type { GLCall, SerializedArg } from './types.js';

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

// A freshly linked program starts with every uniform zeroed — reusing the
// old vertex shader unchanged is worthless if its transform uniforms
// (model/view/projection matrices, etc.) never get copied over, since the
// vertex math then just computes zero/degenerate positions.
function copyUniforms(gl: WebGL2RenderingContext, oldProgram: WebGLProgram, newProgram: WebGLProgram): void {
  const count = gl.getProgramParameter(oldProgram, gl.ACTIVE_UNIFORMS) as number;
  gl.useProgram(newProgram);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(oldProgram, i);
    if (!info) continue;
    const oldLoc = gl.getUniformLocation(oldProgram, info.name);
    const newLoc = gl.getUniformLocation(newProgram, info.name);
    if (!oldLoc || !newLoc) continue; // e.g. a uniform only the old fragment shader declared
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
        gl.uniform1i(newLoc, value);
        break;
      case gl.FLOAT_MAT2: gl.uniformMatrix2fv(newLoc, false, value); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(newLoc, false, value); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(newLoc, false, value); break;
      default:
        break; // best-effort: uncommon types (uint/matNxM/etc.) skipped
    }
    // WebGL errors don't throw — a failed uniform*() call above is a silent
    // no-op otherwise, leaving that one uniform zeroed with no visible sign why.
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      console.warn('[wgd] copyUniforms: failed to set', info.name, '(type', info.type, ') — GL error', err, {
        boundProgram: gl.getParameter(gl.CURRENT_PROGRAM) === newProgram ? 'newProgram (expected)' : 'NOT newProgram',
        oldLoc,
        newLoc,
      });
    }
  }
}

export function useHighlightShader(gl: WebGL2RenderingContext): WebGLProgram | null {
  const oldProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  if (!oldProgram) return null;
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
        precision mediump float;
        layout(location=0) out vec4 fragColor;
        void main() {
          fragColor = vec4(1.0, 0.0, 1.0, 1.0);
        }` : `
        precision mediump float;
        void main() {
          gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
        }`;

        console.log(pixelSource);

        gl.shaderSource(pixelShader, pixelSource);
        gl.compileShader(pixelShader);
        if (!gl.getShaderParameter(pixelShader, gl.COMPILE_STATUS)) {
          console.error('shader compile failed:', gl.getShaderInfoLog(pixelShader));
          gl.deleteShader(pixelShader);
          return null;
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
        // Once linked, the program keeps whatever it needs internally — the
        // shader object itself can and should be freed immediately.
        gl.deleteShader(pixelShader);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          console.error('program link failed:', gl.getProgramInfoLog(program));
          gl.deleteProgram(program);
          return null;
        }
        copyUniforms(gl, oldProgram, program); // leaves `program` bound (copyUniforms needs it current to set values)
        return program;
      }
    }
  }
  return null;
}

export enum DRAW_CALL_DEBUG_MODE {
  NONE,
  HIGHLIGHT
}

// Tracks the override program from the *last* replay so a fresh one can
// clean it up first. Without this, an override program left bound on the
// shared, persistent context (nothing ever unbinds it) can masquerade as
// "the real current program" for whichever later replay's target doesn't
// itself hit another useProgram call before reaching it — highlighting a
// highlight, with whatever uniform values happened to get copied last time.
let activeOverrideProgram: WebGLProgram | null = null;

function cleanupOverrideProgram(gl: WebGL2RenderingContext): void {
  if (!activeOverrideProgram) return;
  gl.useProgram(null);
  gl.deleteProgram(activeOverrideProgram);
  activeOverrideProgram = null;
}

/**
 * Re-issues every recorded call up to and including `targetCallId` against
 * the live `gl` context, which must still hold the same buffers/textures/
 * programs used during capture — true for a paused debug session, since
 * nothing has run since. Called fresh for whichever call is currently being
 * looked at (not for the whole frame up front), so cost scales with what's
 * actually being inspected. Calls after targetCallId are never replayed, so
 * this also naturally shows "the state after the most recent thing that
 * changed the picture" for a call that doesn't itself paint anything — e.g.
 * selecting a bindBuffer call reads back whatever the last draw/clear before
 * it left in the framebuffer.
 */
export function replayCalls(gl: object, calls: readonly GLCall[], registry: ObjectRegistry, targetCallId: number, debug_mode: DRAW_CALL_DEBUG_MODE = DRAW_CALL_DEBUG_MODE.NONE): void {
  const target = gl as Record<string, (...a: unknown[]) => unknown>;
  cleanupOverrideProgram(gl as WebGL2RenderingContext);
  const stopAt = Math.min(targetCallId, calls.length - 1);
  for (let i = 0; i <= stopAt; i++) {
    const call = calls[i];
    if (call.threwError) continue; // never happened for real; nothing to replay
    const args = call.args.map((a) => toReplayArg(a, registry));
    try {
      if (debug_mode === DRAW_CALL_DEBUG_MODE.HIGHLIGHT && i === stopAt) activeOverrideProgram = useHighlightShader(gl as WebGL2RenderingContext);
      target[call.name](...args);
    } catch {
      // best-effort: skip calls that fail to replay against current live state
    }
  }
}
