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

// Linking resets program-local state. The override must use the original
// vertex uniforms, including each array element and uniform-block binding.
function copyUniforms(gl: WebGL2RenderingContext, oldProgram: WebGLProgram, newProgram: WebGLProgram): void {
  gl.useProgram(newProgram);
  const count = gl.getProgramParameter(newProgram, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(newProgram, i);
    if (!info) continue;
    for (let element = 0; element < info.size; element++) {
      const arrayIndex = info.name.lastIndexOf('[0]');
      const name = info.size > 1 && arrayIndex >= 0
        ? `${info.name.slice(0, arrayIndex)}[${element}]${info.name.slice(arrayIndex + 3)}`
        : info.name;
      const oldLoc = gl.getUniformLocation(oldProgram, name);
      const newLoc = gl.getUniformLocation(newProgram, name);
      if (oldLoc === null || newLoc === null) continue; // uniform-block members have no location
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
        case gl.SAMPLER_3D:
        case gl.SAMPLER_2D_SHADOW:
        case gl.SAMPLER_2D_ARRAY:
        case gl.SAMPLER_2D_ARRAY_SHADOW:
        case gl.SAMPLER_CUBE_SHADOW:
        case gl.INT_SAMPLER_2D:
        case gl.INT_SAMPLER_3D:
        case gl.INT_SAMPLER_CUBE:
        case gl.INT_SAMPLER_2D_ARRAY:
        case gl.UNSIGNED_INT_SAMPLER_2D:
        case gl.UNSIGNED_INT_SAMPLER_3D:
        case gl.UNSIGNED_INT_SAMPLER_CUBE:
        case gl.UNSIGNED_INT_SAMPLER_2D_ARRAY:
          gl.uniform1i(newLoc, value);
          break;
        case gl.INT_VEC2:
        case gl.BOOL_VEC2: gl.uniform2iv(newLoc, value); break;
        case gl.INT_VEC3:
        case gl.BOOL_VEC3: gl.uniform3iv(newLoc, value); break;
        case gl.INT_VEC4:
        case gl.BOOL_VEC4: gl.uniform4iv(newLoc, value); break;
        case gl.UNSIGNED_INT: gl.uniform1ui(newLoc, value); break;
        case gl.UNSIGNED_INT_VEC2: gl.uniform2uiv(newLoc, value); break;
        case gl.UNSIGNED_INT_VEC3: gl.uniform3uiv(newLoc, value); break;
        case gl.UNSIGNED_INT_VEC4: gl.uniform4uiv(newLoc, value); break;
        case gl.FLOAT_MAT2: gl.uniformMatrix2fv(newLoc, false, value); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(newLoc, false, value); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(newLoc, false, value); break;
        case gl.FLOAT_MAT2x3: gl.uniformMatrix2x3fv(newLoc, false, value); break;
        case gl.FLOAT_MAT2x4: gl.uniformMatrix2x4fv(newLoc, false, value); break;
        case gl.FLOAT_MAT3x2: gl.uniformMatrix3x2fv(newLoc, false, value); break;
        case gl.FLOAT_MAT3x4: gl.uniformMatrix3x4fv(newLoc, false, value); break;
        case gl.FLOAT_MAT4x2: gl.uniformMatrix4x2fv(newLoc, false, value); break;
        case gl.FLOAT_MAT4x3: gl.uniformMatrix4x3fv(newLoc, false, value); break;
      }
    }
  }

  const blockCount = gl.getProgramParameter(newProgram, gl.ACTIVE_UNIFORM_BLOCKS) as number;
  for (let i = 0; i < blockCount; i++) {
    const name = gl.getActiveUniformBlockName(newProgram, i);
    if (name === null) continue;
    // Removing fragment inputs can change block indices; match by name.
    const oldIndex = gl.getUniformBlockIndex(oldProgram, name);
    if (oldIndex === gl.INVALID_INDEX) continue;
    const binding = gl.getActiveUniformBlockParameter(oldProgram, oldIndex, gl.UNIFORM_BLOCK_BINDING) as number;
    gl.uniformBlockBinding(newProgram, i, binding);
  }
}

export function useHighlightShader(gl: WebGL2RenderingContext): WebGLProgram | null {
  const oldProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
  if (!oldProgram) return null;
  const vertexShader = gl.getAttachedShaders(oldProgram)?.find(
    shader => gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.VERTEX_SHADER,
  );
  if (!vertexShader) return null;

  const pixelShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!pixelShader) return null;
  const vertexSource = gl.getShaderSource(vertexShader);
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

  gl.shaderSource(pixelShader, pixelSource);
  gl.compileShader(pixelShader);
  if (!gl.getShaderParameter(pixelShader, gl.COMPILE_STATUS)) {
    console.error('shader compile failed:', gl.getShaderInfoLog(pixelShader));
    gl.deleteShader(pixelShader);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(pixelShader);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, pixelShader);

  // VAOs refer to attribute locations, which can change when linking.
  const attribCount = gl.getProgramParameter(oldProgram, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < attribCount; i++) {
    const info = gl.getActiveAttrib(oldProgram, i);
    if (!info) continue;
    const location = gl.getAttribLocation(oldProgram, info.name);
    if (location >= 0) gl.bindAttribLocation(program, location, info.name);
  }

  gl.linkProgram(program);
  gl.deleteShader(pixelShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  try {
    copyUniforms(gl, oldProgram, program);
  } catch (error) {
    gl.useProgram(oldProgram);
    gl.deleteProgram(program);
    throw error;
  }
  return program;
}

export enum DRAW_CALL_DEBUG_MODE {
  NONE,
  HIGHLIGHT
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
  const stopAt = Math.min(targetCallId, calls.length - 1);
  for (let i = 0; i <= stopAt; i++) {
    const call = calls[i];
    if (call.threwError) continue; // never happened for real; nothing to replay
    const args = call.args.map((a) => toReplayArg(a, registry));
    try {
      if (debug_mode === DRAW_CALL_DEBUG_MODE.HIGHLIGHT && i === stopAt && isDrawCall(call)) {
        const context = gl as WebGL2RenderingContext;
        const originalProgram = context.getParameter(context.CURRENT_PROGRAM) as WebGLProgram | null;
        const wasDepthTestEnabled = context.isEnabled(context.DEPTH_TEST);
        let highlightProgram: WebGLProgram | null = null;
        try {
          highlightProgram = useHighlightShader(context);
          if (highlightProgram) context.disable(context.DEPTH_TEST);
          target[call.name](...args);
        } finally {
          if (wasDepthTestEnabled) context.enable(context.DEPTH_TEST);
          // A frame can inherit its program without recording useProgram.
          // Leave that program usable for the next replay (or resume).
          context.useProgram(originalProgram);
          if (highlightProgram) context.deleteProgram(highlightProgram);
        }
      } else {
        target[call.name](...args);
      }
    } catch {
      // best-effort: skip calls that fail to replay against current live state
    }
  }
}
