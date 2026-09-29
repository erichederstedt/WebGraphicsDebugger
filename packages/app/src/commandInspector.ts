import { DRAW_CALL_DEBUG_MODE, type DebugSession, type GLObjectRef, type GLState } from '@wgd/core';
import { ImGui, ImGui_Impl } from '@zhobo63/imgui-ts';
import { snapshotForCall, type FrameSnapshot } from './thumbnails.js';

const COLOR_DIM = new ImGui.ImVec4(0.541, 0.553, 0.58, 1); // --text-dim
const COLOR_OBJ = new ImGui.ImVec4(1, 0.71, 0.33, 1); // --obj-ref orange
const COLOR_CAP_ON = new ImGui.ImVec4(0.48, 0.88, 0.48, 1);
const HEADER_OPEN = ImGui.TreeNodeFlags.DefaultOpen;
const KV_TABLE_FLAGS = ImGui.TableFlags.RowBg | ImGui.TableFlags.SizingStretchProp;

let pickedPixel: { x: number; y: number; r: number; g: number; b: number; a: number } | null = null;
let previewTexture: ImGui_Impl.Texture | null = null;

// The render-target preview is replayed on demand for whichever call is
// selected, not baked for the whole frame up front — cached here so it's
// only recomputed when the selection actually changes, not every imgui
// frame (drawPreview runs ~60x/sec regardless of whether anything changed).
let cachedSnapshot: FrameSnapshot | null = null;
let cachedSnapshotCallId = -1;

export function resetCommandInspector(): void {
  clearPickedPixel();
  cachedSnapshot = null;
  cachedSnapshotCallId = -1;
}

export function clearPickedPixel(): void {
  pickedPixel = null;
}

export function drawCommandInspector(
  gl: WebGL2RenderingContext,
  session: DebugSession,
  selectedCallId: number,
  width: number,
  height: number,
): void {
  ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);
  const previewHeight = Math.max(160, height * 0.4);
  drawPreview(gl, session, selectedCallId, width, previewHeight);
  drawStatePanel(session.getStateAt(selectedCallId), width, height - previewHeight - ImGui.GetStyle().ItemSpacing.y);
  ImGui.EndChild();
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function largestTextWidth(texts: string[]): number {
  var largest_width = 0.0;
  for (let i = 0; i < texts.length; i++) {
    const size = ImGui.CalcTextSize(texts[i]);
    largest_width = (largest_width > size.x) ? largest_width : size.x;
  }
  return largest_width;
}

const overlay_items = ["None", "Highlight"];
var overlay_current_item = overlay_items[0];
var overlay_dirty = false;
function drawPreview(
  gl: WebGL2RenderingContext,
  session: DebugSession,
  selectedCallId: number,
  width: number,
  height: number,
): void {
  ImGui.BeginChild('preview', new ImGui.ImVec2(width, height), true);
  ImGui.TextColored(COLOR_DIM, 'RENDER TARGET');
  ImGui.SameLine();
  ImGui.Text("|");
  ImGui.SameLine();
  ImGui.SetNextItemWidth(largestTextWidth(overlay_items) + 50);
  if (ImGui.BeginCombo("Overlay", overlay_current_item)) {
    for (let i = 0; i < overlay_items.length; i++) {
      if (ImGui.Selectable(overlay_items[i], overlay_items[i] == overlay_current_item)) {
        overlay_current_item = overlay_items[i];
        overlay_dirty = true;
      }
    }
    ImGui.EndCombo();
  }
  ImGui.Separator();

  if (cachedSnapshotCallId !== selectedCallId || overlay_dirty == true) {
    cachedSnapshot = snapshotForCall(gl, session.calls, session.registry, selectedCallId, (overlay_current_item == "Highlight") ? DRAW_CALL_DEBUG_MODE.HIGHLIGHT : DRAW_CALL_DEBUG_MODE.NONE);
    cachedSnapshotCallId = selectedCallId;
    if (cachedSnapshot) {
      if (!previewTexture) previewTexture = new ImGui_Impl.Texture();
      previewTexture.Update(cachedSnapshot.canvas);
    }
  }
  const snapshot: FrameSnapshot | null = cachedSnapshot;

  if (!snapshot) {
    ImGui.TextColored(COLOR_DIM, 'No render target yet.');
  } else {
    const avail = ImGui.GetContentRegionAvail();
    const budgetHeight = Math.max(1, avail.y - 28);
    const scale = Math.min(avail.x / snapshot.width, budgetHeight / snapshot.height);
    const w = snapshot.width * scale;
    const h = snapshot.height * scale;

    ImGui.Image(previewTexture!._texture ?? null, new ImGui.ImVec2(w, h));
    if (ImGui.IsItemHovered() && ImGui.IsMouseClicked(0)) {
      const min = ImGui.GetItemRectMin();
      const mouse = ImGui.GetMousePos();
      const px = Math.floor((mouse.x - min.x) / scale);
      const py = Math.floor((mouse.y - min.y) / scale);
      if (px >= 0 && py >= 0 && px < snapshot.width && py < snapshot.height) {
        const [r, g, b, a] = snapshot.pixelAt(px, py);
        pickedPixel = { x: px, y: py, r, g, b, a };
      }
    }

    if (pickedPixel) {
      const { x, y, r, g, b, a } = pickedPixel;
      ImGui.TextColored(new ImGui.ImVec4(r / 255, g / 255, b / 255, 1), '■');
      ImGui.SameLine();
      ImGui.Text(`(${x}, ${y})  rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})  #${toHex(r)}${toHex(g)}${toHex(b)}`);
    } else {
      ImGui.TextColored(COLOR_DIM, 'Click a pixel to inspect its color.');
    }
  }

  ImGui.EndChild();
}

function objText(ref: GLObjectRef | null): { text: string; color: ImGui.ImVec4 } {
  return ref ? { text: `${ref.type}#${ref.id}`, color: COLOR_OBJ } : { text: 'null', color: COLOR_DIM };
}

function kvRow(key: string, text: string, color?: Readonly<ImGui.ImVec4>): void {
  ImGui.TableNextRow();
  ImGui.TableNextColumn();
  ImGui.TextColored(COLOR_DIM, key);
  ImGui.TableNextColumn();
  if (color) ImGui.TextColored(color, text);
  else ImGui.Text(text);
}

function objRow(key: string, ref: GLObjectRef | null): void {
  const { text, color } = objText(ref);
  kvRow(key, text, color);
}

function section(title: string, id: string, body: () => void): void {
  if (!ImGui.CollapsingHeader(title, HEADER_OPEN)) return;
  if (ImGui.BeginTable(id, 2, KV_TABLE_FLAGS)) {
    body();
    ImGui.EndTable();
  }
}

function drawStatePanel(state: GLState, width: number, height: number): void {
  ImGui.BeginChild('state-panel', new ImGui.ImVec2(width, Math.max(1, height)), true);

  section('Buffer Bindings', 'buffers', () => {
    for (const [key, ref] of Object.entries(state.bufferBindings)) objRow(key, ref);
  });

  section(`Textures (active unit ${state.activeTextureUnit})`, 'textures', () => {
    state.textureUnits.forEach((unit, i) => {
      for (const [key, ref] of Object.entries(unit)) objRow(`[${i}] ${key}`, ref);
    });
  });

  section('Program & Framebuffer', 'program-fb', () => {
    objRow('CURRENT_PROGRAM', state.currentProgram);
    objRow('DRAW_FRAMEBUFFER', state.framebufferBindings.DRAW_FRAMEBUFFER);
    objRow('READ_FRAMEBUFFER', state.framebufferBindings.READ_FRAMEBUFFER);
    objRow('RENDERBUFFER', state.renderbufferBinding);
    objRow('VERTEX_ARRAY', state.vertexArrayBinding);
  });

  if (ImGui.CollapsingHeader('Vertex Attribs', HEADER_OPEN)) {
    if (state.vertexAttribs.length === 0) {
      ImGui.TextColored(COLOR_DIM, '(none configured)');
    } else if (ImGui.BeginTable('vertex-attribs', 2, KV_TABLE_FLAGS)) {
      state.vertexAttribs.forEach((a, i) => {
        const buf = a.buffer ? `${a.buffer.type}#${a.buffer.id}` : 'null';
        kvRow(`[${i}]`, `${a.enabled ? 'enabled' : 'disabled'} size=${a.size} type=${a.type ? a.type.name : '-'} stride=${a.stride} offset=${a.offset} buffer=${buf}`);
      });
      ImGui.EndTable();
    }
  }

  section('Viewport & Scissor', 'viewport', () => {
    kvRow('VIEWPORT', `${state.viewport.x}, ${state.viewport.y}, ${state.viewport.width}x${state.viewport.height}`);
    kvRow('SCISSOR_BOX', `${state.scissorBox.x}, ${state.scissorBox.y}, ${state.scissorBox.width}x${state.scissorBox.height}`);
    kvRow('SCISSOR_TEST', state.capabilities.SCISSOR_TEST ? 'on' : 'off', state.capabilities.SCISSOR_TEST ? COLOR_CAP_ON : COLOR_DIM);
  });

  section('Clear Values', 'clear-values', () => {
    kvRow('COLOR_CLEAR_VALUE', state.clearColor.join(', '));
    kvRow('DEPTH_CLEAR_VALUE', String(state.clearDepth));
    kvRow('STENCIL_CLEAR_VALUE', String(state.clearStencil));
  });

  section('Capabilities', 'capabilities', () => {
    for (const [key, on] of Object.entries(state.capabilities)) kvRow(key, on ? 'on' : 'off', on ? COLOR_CAP_ON : COLOR_DIM);
  });

  section('Blend', 'blend', () => {
    kvRow('SRC_RGB / DST_RGB', `${state.blend.srcRGB.name} / ${state.blend.dstRGB.name}`);
    kvRow('SRC_ALPHA / DST_ALPHA', `${state.blend.srcAlpha.name} / ${state.blend.dstAlpha.name}`);
    kvRow('EQUATION_RGB / ALPHA', `${state.blend.equationRGB.name} / ${state.blend.equationAlpha.name}`);
  });

  section('Depth & Cull', 'depth-cull', () => {
    kvRow('DEPTH_FUNC', state.depth.func.name);
    kvRow('DEPTH_WRITEMASK', String(state.depth.mask));
    kvRow('CULL_FACE_MODE', state.cull.mode.name);
    kvRow('FRONT_FACE', state.cull.frontFace.name);
  });

  const pixelStoreEntries = Object.entries(state.pixelStore);
  if (pixelStoreEntries.length > 0) {
    section('Pixel Store', 'pixel-store', () => {
      for (const [key, value] of pixelStoreEntries) kvRow(key, String(value));
    });
  }

  ImGui.EndChild();
}
