import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseObj, parseMtl } from '../src/objLoader.js';

describe('OBJ input', () => {
  it('resolves separate and negative indices, triangulates quads, and retains material groups', () => {
    const mesh = parseObj(`mtllib scene.mtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
g front
usemtl stone
f -4/-4/1 -3/-3/1 -2/-2/1 -1/-1/1
usemtl trim
f 1/1/1 3/3/1 4/4/1`);
    expect(mesh.materialLibraries).toEqual(['scene.mtl']);
    expect([...mesh.indices]).toEqual([0, 1, 2, 0, 2, 3, 0, 2, 3]);
    expect(mesh.vertices.length).toBe(4 * 8);
    expect([...mesh.vertices.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 1, 0, 0]);
    expect(mesh.parts).toEqual([
      { name: 'front', material: 'stone', firstIndex: 0, count: 6 },
      { name: 'front', material: 'trim', firstIndex: 6, count: 3 },
    ]);
    expect(mesh.min).toEqual([0, 0, 0]);
    expect(mesh.max).toEqual([1, 1, 0]);
  });

  it('splits UV seams and generates flat normals for position-only faces', () => {
    const mesh = parseObj(`v 0 0 0
v 1 0 0
v 0 1 0
vt 0 0
vt 1 1
vn 0 0 1
f 1/1/1 2/1/1 3/1/1
f 1/2/1 2/1/1 3/1/1
f 1 2 3`);
    expect([...mesh.indices]).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 6]);
    expect([...mesh.vertices.slice(4 * 8 + 3, 4 * 8 + 8)]).toEqual([0, 0, 1, 0, 0]);
  });

  it.each(['0', '4', '-4', '1.5', 'wat'])('rejects an invalid face index %s', index => {
    expect(() => parseObj(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 ${index}`)).toThrow('invalid index');
  });

  it('rejects empty meshes', () => expect(() => parseObj('v 0 0 0')).toThrow('no polygon faces'));

  it('loads diffuse MTL colors and filenames with spaces', () => {
    const material = parseMtl('newmtl stone\nKd 0.2 0.3 0.4\nmap_Kd textures\\stone wall.jpg').get('stone');
    expect(material).toEqual({ color: [0.2, 0.3, 0.4], texture: 'textures/stone wall.jpg' });
  });

  it.each(['sponza', 'sibenik'])('parses bundled %s and resolves every referenced diffuse texture', scene => {
    const base = new URL(`../public/scenes/${scene}/`, import.meta.url);
    const mesh = parseObj(readFileSync(new URL(`${scene}.obj`, base), 'utf8'));
    expect(mesh.indices.length).toBeGreaterThan(100_000);
    expect(mesh.parts.length).toBeGreaterThan(10);
    expect(mesh.indices.reduce((max, index) => Math.max(max, index), 0)).toBeLessThan(mesh.vertices.length / 8);
    for (const name of mesh.materialLibraries) {
      const materials = parseMtl(readFileSync(new URL(name, base), 'utf8'));
      for (const part of mesh.parts) expect(materials.has(part.material)).toBe(true);
      for (const material of materials.values()) {
        if (material.texture) expect(existsSync(new URL(material.texture, base))).toBe(true);
      }
    }
  });
});
