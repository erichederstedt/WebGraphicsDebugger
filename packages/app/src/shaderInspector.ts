import GLSL from '@eric.hederstedt/glsl-transpiler';
import { CreateTextEditor, ImGui, TextEditor, TextEditorErrorMarker } from "@eric.hederstedt/imgui-ts";
import imgui, { LabelText } from "@eric.hederstedt/imgui-ts/src/imgui";
import { DebugSession, GLState, objectById } from "@wgd/core";
import { pickedPixel } from "./commandInspector";
import { captureGeometry, vertexData } from './geometryInspector';
import { createShader, Shader, ShaderType } from "./glUtil";

let editor: TextEditor | null = null;

// Call once, after `await ImGui.default()` and ImGui_Impl.Init(...)
function initShaderView(source: string): void {
    editor = CreateTextEditor();          // GLSL language, dark palette
    editor.SetText(source);
    editor.SetTabSize(4);
}

export const shaderInspectorData = {
    inspectedVertexIndex: -1
};
// Call every frame, inside your normal ImGui frame.
function drawShaderView(onBreakpointsChanged: (lines: number[]) => void): void {
    if (!editor) return;

    if (ImGui.InputInt("Vertex Index", (_ = shaderInspectorData.inspectedVertexIndex) => shaderInspectorData.inspectedVertexIndex = _)) {
        shaderInspectorData.inspectedVertexIndex = clamp(shaderInspectorData.inspectedVertexIndex, 0, vertexData ? (vertexData.vertexCount - 1) : 0);
    }

    if (ImGui.Button("Play")) { }
    ImGui.SameLine();
    if (ImGui.Button("Pause")) { }
    ImGui.SameLine();
    if (ImGui.Button("Step")) { }
    ImGui.SameLine();
    if (ImGui.Button("Reset")) { }

    // ImGui.Begin("Shader");
    // 0,0 = fill the remaining space of the window
    editor.Render("##glsl", 0, 0, false);
    // ImGui.End();

    // Gutter clicks, and edits that move lines, both set this flag.
    if (editor.ConsumeBreakpointsChanged())
        onBreakpointsChanged(editor.GetBreakpoints());
}

// Debugger paused at `line` (1-based): highlight it, lock editing, scroll to it.
function onPaused(line: number): void {
    editor?.SetReadOnly(true);
    editor?.SetExecutionLine(line, true);
}

function onResumed(): void {
    editor?.SetExecutionLine(0, false);
    editor?.SetReadOnly(false);
}

// Turn a WebGL shader info log into red error lines with hover tooltips.
// Format: "ERROR: 0:12: 'foo' : undeclared identifier"
function showCompileErrors(gl: WebGL2RenderingContext, shader: WebGLShader): void {
    if (!editor) return;
    const log = gl.getShaderInfoLog(shader) ?? "";
    const markers: TextEditorErrorMarker[] = [];
    for (const m of log.matchAll(/^ERROR:\s*\d+:(\d+):\s*(.*)$/gm))
        markers.push({ line: Number(m[1]), message: m[2] });
    editor.SetErrorMarkers(markers);
}

function disposeShaderView(): void {
    editor?.delete();                     // frees the C++ object
    editor = null;
}

function compileShaderView(gl: WebGL2RenderingContext, shaderSource: string, type: ShaderType): WebGLShader {
    let shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);
    const compile = GLSL({
        uniform: (name: string) => `uniforms.${name}`,
        attribute: (name: string) => `attributes.${name}`,
        varying: (name: string) => `varyings.${name}`,
        in: (name: string) => `inputs.${name}`,
        out: (name: string) => `outputs.${name}`,
        version: '100 es',
        includes: true,
        debug: false,
        sourceMap: true

    });
    const javascript = compile(shaderSource);
    console.log(javascript)
    return shader;
}

function getSourceFromProgram(gl: WebGL2RenderingContext, program: WebGLProgram, type: ShaderType): string {
    const shader = gl.getAttachedShaders(program)?.find(
        shader => gl.getShaderParameter(shader, gl.SHADER_TYPE) === type,
    );
    if (!shader)
        return "Source not found!";

    const shaderSource = gl.getShaderSource(shader);
    if (!shaderSource)
        return "Source not found!";

    return shaderSource;
}

function initShaderInspector(gl: WebGL2RenderingContext): void {
    initShaderView("");
}
let hasInit = false;
let prevSelectedCallId: number | null = null;
let state: GLState | null = null;
enum Tab {
    None,
    Vertex,
    Fragment
}
let prevTab: Tab = Tab.None;
export function drawShaderInspector(gl: WebGL2RenderingContext, session: DebugSession, selectedCallId: number, width: number, height: number): void {
    if (!hasInit) {
        initShaderInspector(gl);
        hasInit = true;
    }

    if (prevSelectedCallId != selectedCallId) {
        state = session.getStateAt(selectedCallId);
        captureGeometry(gl, session, selectedCallId, false);
    }

    ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);
    if (ImGui.BeginTabBar('wgd-shader-inspector-menu')) {
        if (ImGui.BeginTabItem('Vertex Shader')) {
            let editorUpdate = false;
            if (prevTab != Tab.Vertex || prevSelectedCallId != selectedCallId) {
                const ref = state?.currentProgram;
                if (ref) {
                    const program = objectById(session.registry, ref.id) as WebGLProgram;
                    const source = getSourceFromProgram(gl, program, ShaderType.Vertex);
                    editor?.SetText(source);
                    editorUpdate = true;
                }
                prevTab = Tab.Vertex;
            }
            drawShaderView((lines: number[]) => { });
            if (editor?.IsTextChanged() || editorUpdate) {
                const shader = compileShaderView(gl, editor ? editor.GetText() : "", ShaderType.Vertex);
                showCompileErrors(gl, shader);
                gl.deleteShader(shader);
                console.log("refresh vertex");
            }
            ImGui.EndTabItem();
        }
        if (ImGui.BeginTabItem('Fragment Shader')) {
            let editorUpdate = false;
            if (prevTab != Tab.Fragment || prevSelectedCallId != selectedCallId) {
                const ref = state?.currentProgram;
                if (ref) {
                    const program = objectById(session.registry, ref.id) as WebGLProgram;
                    const source = getSourceFromProgram(gl, program, ShaderType.Fragment);
                    editor?.SetText(source);
                    editorUpdate = true;
                }
                prevTab = Tab.Fragment;
            }
            drawShaderView((lines: number[]) => { });
            if (editor?.IsTextChanged() || editorUpdate) {
                const shader = compileShaderView(gl, editor ? editor.GetText() : "", ShaderType.Fragment);
                showCompileErrors(gl, shader);
                gl.deleteShader(shader);
                console.log("refresh fragment");
            }
            ImGui.EndTabItem();
        }
        ImGui.EndTabBar();
    }
    ImGui.EndChild();
    prevSelectedCallId = selectedCallId;
}
function clamp(vertexIndex: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, vertexIndex));
}
