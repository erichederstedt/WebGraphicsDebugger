// Linking resets program-local state. The override must use the original
// vertex uniforms, including each array element and uniform-block binding.
export function copyUniforms(gl: WebGL2RenderingContext, oldProgram: WebGLProgram, newProgram: WebGLProgram): void {
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

