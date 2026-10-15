import type { CapturedVertexAttributes } from './vertexData.js';

export interface PostMesh {
    data: CapturedVertexAttributes;
    mode: number;
    outside: number;
    behind: number;
    invalid: number;
    omittedPrimitives: number;
}

// NDC is a diagnostic coordinate system, not reconstructed world/view space.
// Preserve raw clip-space outputs in the table; only this preview divides by w.
export function buildPostMesh(output: CapturedVertexAttributes, mode: number, instances: number): PostMesh {
    const clip = output.vertexAttributes.get('gl_Position')!;
    const ndc = new Float32Array(output.vertexCount * 3);
    const status = new Uint8Array(output.vertexCount);
    let outside = 0, behind = 0, invalid = 0;
    for (let i = 0; i < output.vertexCount; i++) {
        const w = clip[i * 4 + 3];
        let valid = Number.isFinite(w) && w !== 0;
        let clipped = w <= 0;
        for (let c = 0; c < 3; c++) {
            const value = clip[i * 4 + c];
            ndc[i * 3 + c] = value / w;
            if (!Number.isFinite(ndc[i * 3 + c])) valid = false;
            if (value < -w || value > w) clipped = true;
        }
        if (!valid) { status[i] = 3; invalid++; }
        else if (w < 0) { status[i] = 2; behind++; }
        else if (clipped) status[i] = 1;
        if (clipped) outside++;
    }
    const lengths: number[] = [];
    if (output.indexBuffer) {
        const restart = Math.pow(2, output.indexBuffer.BYTES_PER_ELEMENT * 8) - 1;
        let count = 0;
        for (let i = 0; i < output.indexBuffer.length; i++) {
            if (output.indexBuffer[i] === restart) { lengths[lengths.length] = count; count = 0; }
            else count++;
        }
        lengths[lengths.length] = count;
    } else lengths[0] = output.vertexCount / instances;

    const positions: number[] = [], colors: number[] = [];
    const primitive: number[] = [];
    const outputMode = mode >= 4 ? 4 : mode === 0 ? 0 : 1; // TRIANGLES, POINTS, LINES
    let first = 0, omittedPrimitives = 0;
    for (let instance = 0; instance < instances; instance++) {
        for (let range = 0; range < lengths.length; range++) {
            const count = lengths[range];
            const step = mode === 4 ? 3 : mode === 1 ? 2 : 1;
            const primitiveSize = outputMode === 4 ? 3 : outputMode === 1 ? 2 : 1;
            const end = mode === 2 ? count : count - primitiveSize + 1;
            for (let i = 0; i < end; i += step) {
                primitive[0] = first + i;
                primitive[1] = first + i + 1;
                primitive[2] = first + i + 2;
                if (mode === 2) primitive[1] = first + (i + 1) % count; // LINE_LOOP
                if (mode === 5 && i % 2 !== 0) { primitive[0] = first + i + 1; primitive[1] = first + i; }
                if (mode === 6) { primitive[0] = first; primitive[1] = first + i + 1; primitive[2] = first + i + 2; }
                let omit = false;
                const negativeW = status[primitive[0]] === 2;
                for (let c = 0; c < primitiveSize; c++) {
                    if (status[primitive[c]] === 3 || (status[primitive[c]] === 2) !== negativeW) omit = true;
                }
                // A primitive crossing w=0 passes through infinity after division.
                if (omit) { omittedPrimitives++; continue; }
                for (let c = 0; c < primitiveSize; c++) {
                    const vertex = primitive[c];
                    for (let axis = 0; axis < 3; axis++) positions[positions.length] = ndc[vertex * 3 + axis];
                    colors[colors.length] = status[vertex];
                }
            }
            first += count;
        }
    }
    const attributes = new Map<string, number[]>();
    attributes.set('NDC position', positions);
    attributes.set('_clipStatus', colors);
    return {
        data: { vertexCount: positions.length / 3, indexCount: 0, indexBuffer: null, vertexAttributes: attributes },
        mode: outputMode, outside, behind, invalid, omittedPrimitives,
    };
}

export function clipVolumeLines(): Float32Array {
    const vertices: number[] = [];
    for (let corner = 0; corner < 8; corner++) {
        for (let axis = 0; axis < 3; axis++) {
            if ((corner & (1 << axis)) !== 0) continue;
            for (let endpoint = 0; endpoint < 2; endpoint++) {
                const index = corner | (endpoint << axis);
                for (let c = 0; c < 3; c++) vertices[vertices.length] = (index & (1 << c)) !== 0 ? 1 : -1;
                // Near face cyan, far face yellow, joining edges white.
                vertices[vertices.length] = axis === 2 ? 6 : (corner & 4) === 0 ? 4 : 5;
            }
        }
    }
    return new Float32Array(vertices);
}
