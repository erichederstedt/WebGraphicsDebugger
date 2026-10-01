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
