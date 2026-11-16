import { CreateTextEditor, ImGui, TextEditor, TextEditorErrorMarker } from "@eric.hederstedt/imgui-ts";
import { LabelText } from "@eric.hederstedt/imgui-ts/src/imgui";
import { DebugSession, GLState, objectById } from "@wgd/core";
import { pickedPixel } from "./commandInspector";
import { createShader, Shader, ShaderType } from "./glUtil";

let editor: TextEditor | null = null;

// Call once, after `await ImGui.default()` and ImGui_Impl.Init(...)
function initShaderView(source: string): void {
    editor = CreateTextEditor();          // GLSL language, dark palette
    editor.SetText(source);
    editor.SetTabSize(4);
}

// Call every frame, inside your normal ImGui frame.
function drawShaderView(onBreakpointsChanged: (lines: number[]) => void): void {
    if (!editor) return;

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
    const shaderSource = `#version 300 es
precision mediump float;
out vec4 FragColor;
in vec4 vertexColor; // the input variable from the vertex shader (same name and same type)  

void main()
{
    FragColor = vertexColor;
}`;
    initShaderView(shaderSource);
    const shader = compileShaderView(gl, shaderSource, ShaderType.Fragment);
    showCompileErrors(gl, shader);
    gl.deleteShader(shader);
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
    }

    ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);
    if (ImGui.BeginTabBar('wgd-shader-inspector-menu')) {
        if (ImGui.BeginTabItem('Vertex Shader')) {
            if (prevTab != Tab.Vertex) {
                const ref = state?.currentProgram;
                if (ref) {
                    const program = objectById(session.registry, ref.id) as WebGLProgram;
                    const source = getSourceFromProgram(gl, program, ShaderType.Vertex);
                    editor?.SetText(source);
                }
                prevTab = Tab.Vertex;
            }
            drawShaderView((lines: number[]) => { });
            if (editor?.IsTextChanged()) {
                const shader = compileShaderView(gl, editor.GetText(), ShaderType.Vertex);
                showCompileErrors(gl, shader);
                gl.deleteShader(shader);
                console.log("refresh vertex");
            }
            ImGui.EndTabItem();
        }
        if (ImGui.BeginTabItem('Fragment Shader')) {
            if (prevTab != Tab.Fragment) {
                const ref = state?.currentProgram;
                if (ref) {
                    const program = objectById(session.registry, ref.id) as WebGLProgram;
                    const source = getSourceFromProgram(gl, program, ShaderType.Fragment);
                    editor?.SetText(source);
                }
                prevTab = Tab.Fragment;
            }
            drawShaderView((lines: number[]) => { });
            if (editor?.IsTextChanged()) {
                const shader = compileShaderView(gl, editor.GetText(), ShaderType.Fragment);
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