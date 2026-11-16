import { ImGui, ImGui_Impl, CreateTextEditor, type TextEditor } from '@eric.hederstedt/imgui-ts';
import { installImGuiKeyboard } from '../../src/imguiKeyboard.js';

export let editor: TextEditor;
export function keyDown(index: number): boolean { return ImGui.GetIO().KeysDown[index]; }

export async function start(): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.style.width = '600px'; canvas.style.height = '400px';
    document.body.style.margin = '0'; document.body.appendChild(canvas);
    await ImGui.default();
    ImGui.CreateContext(); ImGui.GetIO().Fonts.AddFontDefault();
    ImGui_Impl.Init(canvas); installImGuiKeyboard();
    editor = CreateTextEditor(); editor.SetText('abc');
    requestAnimationFrame(frame);
}

function frame(time: number): void {
    ImGui_Impl.NewFrame(time); ImGui.NewFrame();
    ImGui.SetNextWindowPos(new ImGui.ImVec2(0, 0));
    ImGui.SetNextWindowSize(new ImGui.ImVec2(600, 400));
    ImGui.Begin('Editor', null, ImGui.WindowFlags.NoTitleBar | ImGui.WindowFlags.NoResize);
    editor.Render('source', 0, 0, false);
    ImGui.End(); ImGui.Render();
    ImGui_Impl.ClearBuffer(new ImGui.ImVec4(0, 0, 0, 1));
    ImGui_Impl.RenderDrawData(ImGui.GetDrawData());
    requestAnimationFrame(frame);
}
