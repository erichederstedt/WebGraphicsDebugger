import { replayCalls, type DebugSession } from '@wgd/core';
import { ImGui } from '@zhobo63/imgui-ts';
import { drawMeshViewer } from './meshViewer.js';
import { captureVertexAttributes, type CapturedVertexAttributes } from './vertexData.js';

let vertexData: CapturedVertexAttributes | null = null;
let cachedSession: DebugSession | null = null;
let cachedGl: WebGL2RenderingContext | null = null;
let cachedCallId = -1;
let captureError: string | null = null;
let primitiveMode = 4;
let instanceCount = 1;

export function drawGeometryInspector(gl: WebGL2RenderingContext, session: DebugSession, selectedCallId: number, width: number, height: number): void {
  ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);

  if (cachedSession !== session || cachedGl !== gl || cachedCallId !== selectedCallId) {
    vertexData = null;
    captureError = null;
    replayCalls(gl, session.calls, session.registry, selectedCallId, (target, call, args, commandIndex, stopAt) => {
      // Capture before the draw: transform feedback may write into buffers.
      if (commandIndex === stopAt) {
        try {
          vertexData = captureVertexAttributes(gl, call, args);
          primitiveMode = Number(args[0]);
          instanceCount = call.name === 'drawArraysInstanced' ? Number(args[3])
            : call.name === 'drawElementsInstanced' ? Number(args[4]) : 1;
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

  if (captureError) ImGui.Text(`Could not capture vertex inputs: ${captureError}`);

  const vertexAttribute = vertexData?.vertexAttributes ?? new Map<string, number[]>();

  // for (const [key, value] of vertexAttribute) {
  //   console.log(value);
  // }

  // console.log(vertexAttribute);


  const visibleRows = 20;
  const tableHeight = Math.min(ImGui.GetTextLineHeightWithSpacing() * (visibleRows + 1), height * 0.4);
  const flags = ImGui.TableFlags.Borders | ImGui.TableFlags.RowBg | ImGui.TableFlags.SizingFixedFit | ImGui.TableFlags.ContextMenuInBody | ImGui.TableFlags.ScrollX | ImGui.TableFlags.ScrollY;
  const sourceIndices = vertexData?.indexBuffer
    ? Array.from(vertexData.indexBuffer).filter(index => index !== 2 ** (vertexData!.indexBuffer!.BYTES_PER_ELEMENT * 8) - 1)
    : null;
  if (vertexData && ImGui.BeginTable("Vertex Input", 2 + vertexAttribute.size, flags, new ImGui.ImVec2(0, tableHeight))) {
    ImGui.TableSetupScrollFreeze(0, 1);
    ImGui.TableSetupColumn("Vtx");
    ImGui.TableSetupColumn("Idx");
    for (const [key, value] of vertexAttribute) {
      ImGui.TableSetupColumn(key);
    }
    ImGui.TableHeadersRow();

    for (let i = 0; i < vertexData.vertexCount; i++) {
      const vertex = i;
      var index = vertex;
      if (vertexData.indexBuffer) {
        index = sourceIndices?.length ? sourceIndices[i % sourceIndices.length] : i;
      }

      ImGui.TableNextRow();
      ImGui.TableNextColumn();
      ImGui.Text(vertex.toString());
      ImGui.TableNextColumn();
      ImGui.Text(index.toString());

      for (const [key, value] of vertexAttribute) {
        ImGui.TableNextColumn();
        const elementCount = value.length / vertexData.vertexCount;
        var elementString = "";
        for (let j = 0; j < elementCount; j++) {
          if (j != 0)
            elementString += ", ";
          elementString += value[i * elementCount + j].toPrecision(3);
        }
        ImGui.Text("(" + elementString + ")");
      }
    }
    ImGui.EndTable();
  }

  if (ImGui.BeginTabBar('wgd-geometry-inspector-menu')) {
    if (ImGui.BeginTabItem('Pre Vertex Shader')) {
      drawMeshViewer(vertexData, primitiveMode, instanceCount);

      ImGui.EndTabItem();
    }

    if (ImGui.BeginTabItem('Post Vertex Shader')) {
      ImGui.Text("Post-VS position capture is not implemented yet.");
      ImGui.EndTabItem();
    }
    ImGui.EndTabBar();
  }

  ImGui.EndChild();
}
