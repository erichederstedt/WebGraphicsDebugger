import { replayCalls, type DebugSession } from '@wgd/core';
import { ImGui } from '@zhobo63/imgui-ts';
import { drawMeshViewer } from './meshViewer.js';
import { captureVertexAttributes, type CapturedVertexAttributes } from './vertexData.js';
import { capturePostVertexAttributes, type PostVertexCapture } from './postVertexData.js';
import { buildPostMesh, type PostMesh } from './postMesh.js';

let vertexData: CapturedVertexAttributes | null = null;
let postData: PostVertexCapture | null = null;
let postMesh: PostMesh | null = null;
let cachedSession: DebugSession | null = null;
let cachedGl: WebGL2RenderingContext | null = null;
let cachedCallId = -1;
let captureError: string | null = null;
let primitiveMode = 4;
let instanceCount = 1;
let firstVertex = 0;
let sourceIndices: number[] = [];

function captureGeometry(gl: WebGL2RenderingContext, session: DebugSession, selectedCallId: number, postVS: boolean): void {
    const changed = cachedSession !== session || cachedGl !== gl || cachedCallId !== selectedCallId;
    if (!changed && (!postVS || postData !== null || captureError !== null)) return;
    vertexData = null;
    postData = null;
    postMesh = null;
    sourceIndices = [];
    captureError = null;
    replayCalls(gl, session.calls, session.registry, selectedCallId, (target, call, args, commandIndex, stopAt) => {
        if (commandIndex === stopAt) {
            try {
                vertexData = captureVertexAttributes(gl, call, args);
                primitiveMode = Number(args[0]);
                firstVertex = call.name === 'drawArrays' || call.name === 'drawArraysInstanced' ? Number(args[1]) : 0;
                instanceCount = call.name === 'drawArraysInstanced' ? Number(args[3])
                    : call.name === 'drawElementsInstanced' ? Number(args[4]) : 1;
                if (vertexData.indexBuffer) {
                    const restart = Math.pow(2, vertexData.indexBuffer.BYTES_PER_ELEMENT * 8) - 1;
                    for (let i = 0; i < vertexData.indexBuffer.length; i++) {
                        const index = vertexData.indexBuffer[i];
                        if (index !== restart) sourceIndices[sourceIndices.length] = index;
                    }
                }
                if (postVS) {
                    postData = capturePostVertexAttributes(gl, call, args, vertexData);
                    if (postData.data.vertexAttributes.has('gl_Position')) {
                        postMesh = buildPostMesh(postData.data, primitiveMode, instanceCount);
                    }
                }
            } catch (error) {
                captureError = error instanceof Error ? error.message : String(error);
            }
        }
        target[call.name](...args);
    });
    cachedSession = session;
    cachedGl = gl;
    cachedCallId = selectedCallId;
}

function drawVertexTable(data: CapturedVertexAttributes | null, label: string, height: number): void {
    if (data === null) return;
    const names: string[] = [], values: number[][] = [];
    const attributes = data.vertexAttributes.entries();
    let entry = attributes.next();
    while (!entry.done) {
        names[names.length] = entry.value[0];
        values[values.length] = entry.value[1];
        entry = attributes.next();
    }
    const flags = ImGui.TableFlags.Borders | ImGui.TableFlags.RowBg | ImGui.TableFlags.SizingFixedFit |
        ImGui.TableFlags.ContextMenuInBody | ImGui.TableFlags.ScrollX | ImGui.TableFlags.ScrollY;
    const tableHeight = Math.min(ImGui.GetTextLineHeightWithSpacing() * 21, height * 0.4);
    if (!ImGui.BeginTable(label, 3 + names.length, flags, new ImGui.ImVec2(0, tableHeight))) return;
    ImGui.TableSetupScrollFreeze(0, 1);
    ImGui.TableSetupColumn('Instance');
    ImGui.TableSetupColumn('Vtx');
    ImGui.TableSetupColumn('Idx');
    for (let i = 0; i < names.length; i++) ImGui.TableSetupColumn(names[i]);
    ImGui.TableHeadersRow();
    const rowsPerInstance = data.vertexCount / instanceCount;
    const clipper = new ImGui.ListClipper();
    clipper.Begin(data.vertexCount);
    while (clipper.Step()) {
        for (let row = clipper.DisplayStart; row < clipper.DisplayEnd; row++) {
            const vertex = row % rowsPerInstance;
            const index = sourceIndices.length > 0 ? sourceIndices[vertex] : firstVertex + vertex;
            ImGui.TableNextRow();
            ImGui.TableNextColumn(); ImGui.Text(Math.floor(row / rowsPerInstance).toString());
            ImGui.TableNextColumn(); ImGui.Text(vertex.toString());
            ImGui.TableNextColumn(); ImGui.Text(index.toString());
            for (let column = 0; column < names.length; column++) {
                ImGui.TableNextColumn();
                const components = values[column].length / data.vertexCount;
                let text = '(';
                for (let c = 0; c < components; c++) {
                    if (c !== 0) text += ', ';
                    text += values[column][row * components + c].toPrecision(4);
                }
                ImGui.Text(text + ')');
            }
        }
    }
    ImGui.EndTable();
}

export function drawGeometryInspector(gl: WebGL2RenderingContext, session: DebugSession, selectedCallId: number, width: number, height: number): void {
    ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);
    if (ImGui.BeginTabBar('wgd-geometry-inspector-menu')) {
        if (ImGui.BeginTabItem('Pre Vertex Shader')) {
            captureGeometry(gl, session, selectedCallId, false);
            if (captureError) ImGui.Text('Could not capture vertex data: ' + captureError);
            drawVertexTable(vertexData, 'Vertex Input', height);
            drawMeshViewer(vertexData, primitiveMode, instanceCount);
            ImGui.EndTabItem();
        }
        if (ImGui.BeginTabItem('Post Vertex Shader')) {
            captureGeometry(gl, session, selectedCallId, true);
            if (captureError) ImGui.Text('Could not capture vertex data: ' + captureError);
            if (postData) {
                drawVertexTable(postData.data, 'Vertex Output (clip space)', height);
                for (let i = 0; i < postData.unavailable.length; i++) {
                    ImGui.Text('Output inactive or not capturable: ' + postData.unavailable[i]);
                }
            }
            if (postMesh) {
                ImGui.Text('NDC (xyz / w): box = -1 to +1. Near = cyan; far = yellow.');
                ImGui.Text('Outside: ' + postMesh.outside + ' | Behind (w < 0): ' + postMesh.behind +
                    ' | Undefined projection: ' + postMesh.invalid);
                ImGui.Text('Mesh: blue = inside, red = outside, orange = behind (mirrored projection).');
                if (postMesh.omittedPrimitives > 0) {
                    ImGui.Text('Omitted ' + postMesh.omittedPrimitives + ' primitives with undefined projection or crossing w = 0.');
                }
                drawMeshViewer(postMesh.data, postMesh.mode, 1, true);
            } else if (!captureError) ImGui.Text('Select a draw with a capturable gl_Position output.');
            ImGui.EndTabItem();
        }
        ImGui.EndTabBar();
    }
    ImGui.EndChild();
}
