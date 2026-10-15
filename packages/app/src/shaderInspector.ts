import { DebugSession } from "@wgd/core";
import { ImGui } from "@zhobo63/imgui-ts";
import { LabelText } from "@zhobo63/imgui-ts/src/imgui";
import { pickedPixel } from "./commandInspector";

export function drawShaderInspector(gl: WebGL2RenderingContext, session: DebugSession, selectedCallId: number, width: number, height: number): void {
    // pickedPixel
    ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);
    if (ImGui.BeginTabBar('wgd-shader-inspector-menu')) {
        if (ImGui.BeginTabItem('Vertex Shader')) {
            ImGui.Text("Not implemented!");
            ImGui.EndTabItem();
        }
        if (ImGui.BeginTabItem('Fragment Shader')) {
            ImGui.Text("Not implemented!");
            ImGui.EndTabItem();
        }
        ImGui.EndTabBar();
    }
    ImGui.EndChild();
}