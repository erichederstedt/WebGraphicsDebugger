# Demo scenes

Run `npm run dev` from the repository root and choose a scene in the top-left
menu: Triangle, Rotating cube, Sponza (OBJ), or Sibenik (OBJ). Both OBJ scenes are bundled locally;
no external requests are needed to load it.

For another model, unzip it first and choose **Open OBJ files…**. Select one
`.obj` together with its `.mtl` files and diffuse textures. Files stay in the
browser. Texture files in subfolders can be selected alongside the OBJ as long
as their filenames are unique.

Drag to orbit an OBJ scene and scroll to zoom. **Capture Frame** opens the
existing debugger, with separate indexed draws for the OBJ's groups and
materials, and position, normal, and UV vertex attributes.

The loader supports independent and negative OBJ indices, supplied normals
(or generated flat face normals), UVs, and MTL diffuse colors/textures. Polygon
faces use fan triangulation; triangulate concave polygons before exporting.
Smoothing groups, transparency, specular/bump maps, and MTL texture options
are not supported yet.

Sponza attribution and source are in [public/scenes/sponza/README.md](public/scenes/sponza/README.md).

Sibenik attribution and source are in [public/scenes/sibenik/README.md](public/scenes/sibenik/README.md).

# Post vertex shader inspection

Select a draw in the geometry inspector and open **Post Vertex Shader**. The
output table retains raw `gl_Position` (including `w`) and captured shader
outputs. It lists instances and original vertex indices in draw order.

The mesh preview shows `gl_Position.xyz / gl_Position.w` in NDC. The wire box
marks the original WebGL clip volume, -1 to +1 on every axis: the near face
(z = -1) is cyan, the far face (z = +1) is yellow. This is a projected-space
view, not a reconstructed world-space camera frustum. Geometry outside the box
is retained. **Frame mesh** fits the geometry and box; **Frame clip volume**
focuses on the box. Free cam and Arcball work independently from the Pre VS view.

Vertex colors identify inside (blue), outside (red), and negative-w (orange)
positions. Negative-w positions have a mirrored projection; they are not visible
in the original camera. Zero-w/non-finite positions remain in the table but
cannot be plotted. Primitives crossing w = 0 are omitted rather than drawing a
false finite connection through infinity; their count is displayed.

Capture runs once per selection using transform feedback and the original
vertex shader, uniforms, textures, and uniform blocks. Camera movement does not
recapture the shader. Indexed draws retain their vertex IDs and instance IDs;
restart boundaries are preserved. Capture reads the live buffers at replay time,
with the same historical-buffer limitations as the Pre VS capture.

Output discovery handles ordinary global `out`/`varying` declarations, including
numeric arrays and matrices, plus existing transform-feedback declarations.
It does not implement a GLSL preprocessor or expand struct members. Outputs
introduced entirely through macros may not be discovered; outputs rejected by
the linker (including inactive declarations) are listed in the inspector.
