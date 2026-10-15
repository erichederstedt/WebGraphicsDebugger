import { replayCalls, type DebugSession } from '@wgd/core';
import { ImGui, ImGui_Impl } from '@zhobo63/imgui-ts';
import { createProgramFromSource, createRenderTarget, destroyRenderTarget, RenderTarget } from './glUtil.js';
import { captureVertexAttributes, type CapturedVertexAttributes } from './vertexData.js';

let vertexData: CapturedVertexAttributes | null = null;
let cachedSession: DebugSession | null = null;
let cachedGl: WebGL2RenderingContext | null = null;
let cachedCallId = -1;
let captureError: string | null = null;
let cachedMeshViewRenderTarget: RenderTarget | null = null;

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
  const tableHeight = ImGui.GetTextLineHeightWithSpacing() * (visibleRows + 1);
  const flags = ImGui.TableFlags.Borders | ImGui.TableFlags.RowBg | ImGui.TableFlags.SizingFixedFit | ImGui.TableFlags.ContextMenuInBody | ImGui.TableFlags.ScrollX | ImGui.TableFlags.ScrollY;
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
        index = vertexData.indexBuffer[i];
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
      ImGui.Text("1");
      const viewerGl: WebGL2RenderingContext = ImGui_Impl.gl as WebGL2RenderingContext;

      const previousFramebuffer = viewerGl.getParameter(viewerGl.FRAMEBUFFER_BINDING);
      const previousViewport = viewerGl.getParameter(viewerGl.VIEWPORT) as Int32Array;
      const previousClearColor = viewerGl.getParameter(viewerGl.COLOR_CLEAR_VALUE) as Float32Array;
      const scissorEnabled = viewerGl.isEnabled(viewerGl.SCISSOR_TEST);
      const previousProgram = viewerGl.getParameter(viewerGl.CURRENT_PROGRAM);

      const availableScreenSpace = ImGui.GetContentRegionAvail(new ImGui.ImVec2());
      if (cachedMeshViewRenderTarget == null) {
        cachedMeshViewRenderTarget = createRenderTarget(viewerGl, availableScreenSpace);
      }
      if ((cachedMeshViewRenderTarget.size.x != availableScreenSpace.x || cachedMeshViewRenderTarget.size.y != availableScreenSpace.y)) {
        destroyRenderTarget(viewerGl, cachedMeshViewRenderTarget);
        cachedMeshViewRenderTarget = createRenderTarget(viewerGl, availableScreenSpace);
      }
      const renderTarget = cachedMeshViewRenderTarget;
      viewerGl.bindFramebuffer(viewerGl.FRAMEBUFFER, renderTarget.framebuffer);
      viewerGl.viewport(0, 0, renderTarget.size.x, renderTarget.size.y);
      viewerGl.disable(viewerGl.SCISSOR_TEST);
      viewerGl.clearColor(0, 0, 1, 1);
      viewerGl.clear(viewerGl.COLOR_BUFFER_BIT | viewerGl.DEPTH_BUFFER_BIT);

      const vertexShader = `attribute vec4 a_position;
      void main() {
        gl_Position = a_position;
      }`;
      const fragmentShader = `precision mediump float; 
      void main() {
        gl_FragColor = vec4(1, 0, 0.5, 1);
      }`;
      // const program = createProgramFromSource(viewerGl, vertexShader, fragmentShader);

      viewerGl.bindFramebuffer(viewerGl.FRAMEBUFFER, previousFramebuffer);
      viewerGl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
      viewerGl.clearColor(previousClearColor[0], previousClearColor[1], previousClearColor[2], previousClearColor[3]);
      if (scissorEnabled) viewerGl.enable(viewerGl.SCISSOR_TEST);
      viewerGl.useProgram(previousProgram);

      ImGui.Image(renderTarget.texture, renderTarget.size);

      ImGui.EndTabItem();
    }

    if (ImGui.BeginTabItem('Post Vertex Shader')) {
      ImGui.Text("2");
      const availableScreenSpace = ImGui.GetContentRegionAvail(new ImGui.ImVec2());
      ImGui.EndTabItem();
    }
    ImGui.EndTabBar();
  }

  ImGui.EndChild();
}
