import { ImGui } from '@zhobo63/imgui-ts';

export function drawGeometryInspector(width: number, height: number): void {
  ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);

  ImGui.EndChild();
}
