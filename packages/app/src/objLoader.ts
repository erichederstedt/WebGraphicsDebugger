export interface ObjPart {
  name: string;
  material: string;
  firstIndex: number;
  count: number;
}

export interface ObjMesh {
  /** Interleaved position.xyz, normal.xyz, uv.xy. */
  vertices: Float32Array;
  indices: Uint32Array;
  parts: ObjPart[];
  materialLibraries: string[];
  min: number[];
  max: number[];
}

export interface ObjMaterial {
  color: number[];
  texture?: string;
}

/** Polygon faces are triangulated as fans; non-convex faces should be triangulated on export. */
export function parseObj(source: string): ObjMesh {
  const positions: number[][] = [], normals: number[][] = [], uvs: number[][] = [];
  const vertices: number[] = [], indices: number[] = [], parts: ObjPart[] = [];
  const materialLibraries: string[] = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const seen = new Map<string, number>();
  let name = 'mesh', material = '', part: ObjPart | undefined;
  let lineNumber = 0;
  function index(value: string, count: number): number {
    const parsed = Number(value);
    const resolved = parsed < 0 ? count + parsed : parsed - 1;
    if (!Number.isInteger(parsed) || parsed === 0 || resolved < 0 || resolved >= count) throw new Error(`OBJ line ${lineNumber}: invalid index ${value}.`);
    return resolved;
  }
  for (const line of source.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    lineNumber++;
    const text = line.split('#')[0].trim();
    if (!text) continue;
    const [command, ...args] = text.split(/\s+/);
    if (command === 'v' || command === 'vn' || command === 'vt') {
      const size = command === 'vt' ? 2 : 3;
      const values = args.slice(0, size).map(Number);
      if (command === 'vt' && values.length === 1) values.push(0);
      if (values.length !== size || !values.every(Number.isFinite)) throw new Error(`OBJ line ${lineNumber}: invalid ${command}.`);
      (command === 'v' ? positions : command === 'vn' ? normals : uvs).push(values);
    } else if (command === 'mtllib') {
      materialLibraries.push(...args);
    } else if (command === 'usemtl' || command === 'g' || command === 'o') {
      if (command === 'usemtl') material = args.join(' ');
      else name = args.join(' ') || 'mesh';
      part = undefined;
    } else if (command === 'f') {
      if (args.length < 3) throw new Error(`OBJ line ${lineNumber}: face needs at least three vertices.`);
      const face = args.map(token => {
        const [p, uv, n] = token.split('/');
        return [index(p, positions.length), uv ? index(uv, uvs.length) : -1, n ? index(n, normals.length) : -1];
      });
      const a = positions[face[0][0]], b = positions[face[1][0]], c = positions[face[2][0]];
      const u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]);
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...normal) || 1;
      for (let i = 0; i < 3; i++) normal[i] /= length;
      if (!part) {
        part = { name, material, firstIndex: indices.length, count: 0 };
        parts.push(part);
      }
      const faceIndices = face.map(([p, uv, n]) => {
        // OBJ has independent position/normal/UV indices; WebGL needs one index.
        // Missing normals are flat per face, so those vertices cannot be shared.
        const key = `${p}/${uv}/${n < 0 ? `face${lineNumber}` : n}`;
        let vertex = seen.get(key);
        if (vertex === undefined) {
          vertex = vertices.length / 8;
          seen.set(key, vertex);
          vertices.push(...positions[p], ...(n < 0 ? normal : normals[n]), ...(uv < 0 ? [0, 0] : uvs[uv]));
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], positions[p][i]);
            max[i] = Math.max(max[i], positions[p][i]);
          }
        }
        return vertex;
      });
      for (let i = 1; i < faceIndices.length - 1; i++) {
        indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
        part.count += 3;
      }
    }
  }
  if (!indices.length) throw new Error('The OBJ contains no polygon faces.');
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), parts, materialLibraries, min, max };
}

/** The demo renders diffuse Kd/map_Kd materials; lighting is supplied by the viewer. */
export function parseMtl(source: string): Map<string, ObjMaterial> {
  const materials = new Map<string, ObjMaterial>();
  let material: ObjMaterial | undefined;
  for (const line of source.split(/\r?\n/)) {
    const [command, ...args] = line.split('#')[0].trim().split(/\s+/);
    if (command === 'newmtl') {
      material = { color: [1, 1, 1] };
      materials.set(args.join(' '), material);
    } else if (material && command === 'Kd') {
      const color = args.slice(0, 3).map(Number);
      if (color.length !== 3 || !color.every(Number.isFinite)) throw new Error('Invalid MTL diffuse color.');
      material.color = color;
    } else if (material && command === 'map_Kd') {
      if (args[0]?.startsWith('-')) throw new Error('MTL map_Kd options are not supported; export plain diffuse texture paths.');
      material.texture = args.join(' ').replace(/\\/g, '/');
    }
  }
  return materials;
}
