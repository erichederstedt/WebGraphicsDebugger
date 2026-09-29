import { DebugSession, GLCall, replayCalls } from '@wgd/core';
import { ImGui } from '@zhobo63/imgui-ts';

export function drawGeometryInspector(gl: WebGL2RenderingContext, session: DebugSession, selectedCallId: number, width: number, height: number): void {
  ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);

  const vertexAttribute: Map<string, number[]> = new Map<string, number[]>();
  replayCalls(gl, session.calls, session.registry, selectedCallId, (target: Record<string, (...a: unknown[]) => unknown>, call: GLCall, args: unknown[], commandIndex: number, stopAt: number) => {
    target[call.name](...args);
    if (commandIndex == stopAt) {
      // Capture vertex data

    }
  });

  if (ImGui.BeginTable("Vertex Input", 2, ImGui.TableFlags.Borders | ImGui.TableFlags.RowBg)) {
    // ImGui.TableHeader("Vertex Input"); // Doesn't seem to do anything???
    ImGui.TableSetupColumn("Vtx");
    ImGui.TableSetupColumn("Idx");
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
