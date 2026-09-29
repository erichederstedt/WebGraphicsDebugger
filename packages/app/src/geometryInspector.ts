import { type DebugSession, replayCalls } from '@wgd/core';
import { ImGui } from '@zhobo63/imgui-ts';
import { captureVertexAttributes } from './vertexData.js';

// Attribute names map to flattened VS-input components in draw order.
let vertexAttribute: Map<string, number[]> = new Map();
let cachedSession: DebugSession | null = null;
let cachedGl: WebGL2RenderingContext | null = null;
let cachedCallId = -1;
let captureError: string | null = null;

export function drawGeometryInspector(gl: WebGL2RenderingContext, session: DebugSession, selectedCallId: number, width: number, height: number): void {
  ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);

  if (cachedSession !== session || cachedGl !== gl || cachedCallId !== selectedCallId) {
    vertexAttribute = new Map();
    captureError = null;
    replayCalls(gl, session.calls, session.registry, selectedCallId, (target, call, args, commandIndex, stopAt) => {
      // Capture before the draw: transform feedback may write into buffers.
      if (commandIndex === stopAt) {
        try {
          vertexAttribute = captureVertexAttributes(gl, call, args);
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

  if (ImGui.BeginTable("Vertex Input", 2 + vertexAttribute.keys.length, ImGui.TableFlags.Borders | ImGui.TableFlags.RowBg)) {
    // ImGui.TableHeader("Vertex Input"); // Doesn't seem to do anything???
    ImGui.TableSetupColumn("Vtx");
    ImGui.TableSetupColumn("Idx");
    for (const key in vertexAttribute.keys) {
      ImGui.TableSetupColumn(key);
    }
    ImGui.TableHeadersRow();

    ImGui.TableNextRow();
    ImGui.TableNextColumn();
    ImGui.Text("5");
    ImGui.TableNextColumn();
    ImGui.Text("8");

    ImGui.TableNextRow();
    ImGui.TableNextColumn();
    ImGui.Text("8");
    ImGui.TableNextColumn();
    ImGui.Text("5");

    ImGui.EndTable();
  }

  ImGui.EndChild();
}
