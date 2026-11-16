import { ImGui, ImGui_Impl } from '@eric.hederstedt/imgui-ts';

// Match the legacy key indices configured by ImGui_Impl.Init.
const keyIndices: Record<string, number> = {
    Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Space: 32,
    PageUp: 33, PageDown: 34, End: 35, Home: 36,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Insert: 45, Delete: 46, NumpadEnter: 176,
};

function updateKey(event: KeyboardEvent): void {
    const io = ImGui.GetIO();
    io.KeyCtrl = event.ctrlKey;
    io.KeyShift = event.shiftKey;
    io.KeyAlt = event.altKey;
    io.KeySuper = event.metaKey;

    let index = keyIndices[event.code];
    if (event.code.length === 4 && event.code.substring(0, 3) === 'Key') {
        index = event.code.charCodeAt(3);
    }
    if (index !== undefined) io.KeysDown[index] = event.type === 'keydown';

    // Let printable keydown events generate keypress; navigation and shortcuts
    // must not also move/scroll the surrounding page while editing.
    if (io.WantCaptureKeyboard && (event.key.length > 1 || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
    }
}

function inputCharacter(event: KeyboardEvent): void {
    // Named keys and control characters are commands, not editor text.
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey) return;
    const character = event.key.charCodeAt(0);
    if (character < 32 || character === 127) return;
    ImGui.GetIO().AddInputCharacter(character);
    if (ImGui.GetIO().WantCaptureKeyboard) event.preventDefault();
}

export function installImGuiKeyboard(): void {
    ImGui_Impl.remove_key_event();
    window.addEventListener('keydown', updateKey);
    window.addEventListener('keyup', updateKey);
    window.addEventListener('keypress', inputCharacter);
}
