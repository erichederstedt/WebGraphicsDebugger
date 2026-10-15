import { expect, it } from 'vitest';
import { buildPostMesh, clipVolumeLines } from '../src/postMesh.js';
import { vertexOutputNames } from '../src/postVertexData.js';
import type { CapturedVertexAttributes } from '../src/vertexData.js';

function capture(positions: number[], indices: Uint16Array | null = null): CapturedVertexAttributes {
    return { vertexCount: positions.length / 4, indexCount: indices ? indices.length : 0,
        indexBuffer: indices, vertexAttributes: new Map([['gl_Position',positions]]) };
}

it('divides by w without removing offscreen geometry and preserves original clip values', () => {
    const data = capture([0,0,0,2, 8,0,0,2, 0,4,0,2]);
    const result = buildPostMesh(data,4,1);
    expect(result.data.vertexAttributes.get('NDC position')).toEqual([0,0,0, 4,0,0, 0,2,0]);
    expect(result.outside).toBe(2);
    expect(data.vertexAttributes.get('gl_Position')).toEqual([0,0,0,2, 8,0,0,2, 0,4,0,2]);
});

it('keeps behind-camera points identifiable and omits undefined projections', () => {
    const result = buildPostMesh(capture([1,0,0,-1, 0,0,0,0, Infinity,0,0,1]),0,1);
    expect(result.behind).toBe(1);
    expect(result.invalid).toBe(2);
    expect(result.omittedPrimitives).toBe(2);
    expect(result.data.vertexAttributes.get('NDC position')).toEqual([-1,-0,-0]);
    expect(result.data.vertexAttributes.get('_clipStatus')).toEqual([2]);
});

it('does not draw false connections across w=0', () => {
    const result = buildPostMesh(capture([0,0,0,1, 1,1,0,-1, 1,0,0,1]),4,1);
    expect(result.data.vertexCount).toBe(0);
    expect(result.omittedPrimitives).toBe(1);
});

it('expands triangle strips without joining restart segments or instances', () => {
    const positions: number[] = [];
    for (let i = 0; i < 14; i++) positions.push(i,0,0,1);
    const result = buildPostMesh(capture(positions,new Uint16Array([0,1,2,3,65535,4,5,6])),5,2);
    const values = result.data.vertexAttributes.get('NDC position')!;
    const order: number[] = [];
    for (let i = 0; i < values.length; i+=3) order.push(values[i]);
    expect(order).toEqual([0,1,2, 2,1,3, 4,5,6, 7,8,9, 9,8,10, 11,12,13]);
});

it('builds 12 clip-box edges with near and far plane colors', () => {
    const vertices = clipVolumeLines();
    expect(vertices.length).toBe(24*4);
    let near = 0, far = 0, sides = 0;
    for(let i=0;i<vertices.length;i+=8) {
        let differing = 0;
        for(let c=0;c<3;c++) {
            expect(Math.abs(vertices[i+c])).toBe(1);
            expect(Math.abs(vertices[i+4+c])).toBe(1);
            if(vertices[i+c] !== vertices[i+4+c]) differing++;
        }
        expect(differing).toBe(1);
        if(vertices[i+3] === 4) near++;
        if(vertices[i+3] === 5) far++;
        if(vertices[i+3] === 6) sides++;
    }
    expect([near,far,sides]).toEqual([4,4,4]);
});

it('finds global outputs, arrays and comma declarations without function out parameters or comments', () => {
    expect(vertexOutputNames(`out highp vec3 normal, tangent;
        flat out uvec2 ids;
        out mat3 basis[2];
        void helper(out float value) { value=1.0; }
        // out vec3 ignored;
        /* out vec4 alsoIgnored; */
        void main() { gl_Position=vec4(1); gl_PointSize=2.0; }`))
        .toEqual(['gl_Position','normal','tangent','ids','basis','gl_PointSize']);
});
