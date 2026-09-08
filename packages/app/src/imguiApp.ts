import type { DebugSession, GLCall, GLObjectRef, GLState } from '@wgd/core';
import { ImGui, ImGui_Impl } from '@zhobo63/imgui-ts';
import imgui from '@zhobo63/imgui-ts/src/imgui.js';
import type { FrameSnapshot, ThumbnailTrack } from './thumbnails.js';

// Immediate-mode UI: no widget objects, no view classes — just free functions
// redrawing every frame from plain module-level state. Selection, scroll
// requests, and the picked pixel all live here as ordinary mutable variables.

const COLOR_BG = new ImGui.ImVec4(0.102, 0.11, 0.126, 1); // --bg
const COLOR_HEADER = new ImGui.ImVec4(0.137, 0.255, 0.388, 1); // --accent-bg
const COLOR_DIM = new ImGui.ImVec4(0.541, 0.553, 0.58, 1); // --text-dim
const COLOR_DANGER = new ImGui.ImVec4(1, 0.42, 0.42, 1); // --danger
const COLOR_OBJ = new ImGui.ImVec4(1, 0.71, 0.33, 1); // --obj-ref orange
const COLOR_CAP_ON = new ImGui.ImVec4(0.48, 0.88, 0.48, 1);
const HEADER_OPEN = ImGui.TreeNodeFlags.DefaultOpen;
const KV_TABLE_FLAGS = ImGui.TableFlags.RowBg | ImGui.TableFlags.SizingStretchProp;

let initPromise: Promise<void> | null = null;
let canvas: HTMLCanvasElement | null = null;
let running = false;
let scheduleFrame: (cb: FrameRequestCallback) => number = (cb) => window.requestAnimationFrame(cb);

let session: DebugSession | null = null;
let redundant: ReadonlyMap<number, number | null> = new Map();
let thumbnails: ThumbnailTrack | null = null;

let selectedCallId = -1;
let scrollToSelected = false;
let pickedPixel: { x: number; y: number; r: number; g: number; b: number; a: number } | null = null;
let previewTexture: ImGui_Impl.Texture | null = null;
let previewTextureCallId = -1;

/** Mounts (once) and (re)populates the imgui-driven inspect UI for a freshly captured frame. */
export async function mountInspectUI(
  container: HTMLElement,
  nextSession: DebugSession,
  nextRedundant: ReadonlyMap<number, number | null>,
  nextThumbnails: ThumbnailTrack,
  opts: { scheduleFrame?: (cb: FrameRequestCallback) => number } = {},
): Promise<void> {
  if (opts.scheduleFrame) scheduleFrame = opts.scheduleFrame;

  session = nextSession;
  redundant = nextRedundant;
  thumbnails = nextThumbnails;
  const lastCall = nextSession.calls[nextSession.calls.length - 1];
  selectedCallId = lastCall ? lastCall.id : -1;
  scrollToSelected = true;
  pickedPixel = null;
  previewTextureCallId = -1;

  await ensureInit(container);
  if (!running) {
    running = true;
    scheduleFrame(loop);
  }
}

async function ensureInit(container: HTMLElement): Promise<void> {
  if (canvas) {
    if (canvas.parentElement !== container) container.appendChild(canvas);
    return initPromise ?? Promise.resolve();
  }
  initPromise = doInit(container);
  return initPromise;
}

// Same button index mapping imgui-ts's own (window-level) pointerdown/up handlers use.
const MOUSE_BUTTON_MAP = [0, 2, 1, 3, 4];

// imgui-ts listens for pointerdown/up on `window`, and pointerdown only acts
// when `event.target === canvas`. Fine on a plain page, but our canvas can
// live inside a Shadow DOM (the injected widget) — per spec, a window-level
// listener sees shadow-tree events retargeted to the shadow host, so that
// check never passes there and MouseDown[0] never goes true: hover/scroll
// use canvas-level listeners internally so they're unaffected, only clicks
// silently do nothing. Attaching our own listeners directly on the canvas
// sidesteps retargeting entirely (harmless duplicate work on a plain page).
function patchPointerEvents(target: HTMLCanvasElement): void {
  target.addEventListener('pointerdown', (e) => {
    ImGui.GetIO().MouseDown[MOUSE_BUTTON_MAP[e.button]] = true;
  });
  target.addEventListener('pointerup', (e) => {
    ImGui.GetIO().MouseDown[MOUSE_BUTTON_MAP[e.button]] = false;
  });
}

async function doInit(container: HTMLElement): Promise<void> {
  canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  await ImGui.default();
  ImGui.CreateContext();
  ImGui.StyleColorsDark();
  ImGui.GetIO().Fonts.AddFontDefault();
  ImGui_Impl.Init(canvas);
  patchPointerEvents(canvas);

  const style = ImGui.GetStyle();
  style.Colors[ImGui.Col.WindowBg] = COLOR_BG;
  style.Colors[ImGui.Col.ChildBg] = COLOR_BG;
  style.Colors[ImGui.Col.Header] = COLOR_HEADER;
  style.Colors[ImGui.Col.HeaderHovered] = COLOR_HEADER;
  style.Colors[ImGui.Col.HeaderActive] = COLOR_HEADER;
}

function loop(time: number): void {
  if (!running || !canvas) return;
  ImGui_Impl.NewFrame(time);
  ImGui.NewFrame();
  drawFrame();
  ImGui.EndFrame();
  ImGui.Render();
  ImGui_Impl.ClearBuffer(COLOR_BG);
  ImGui_Impl.RenderDrawData(ImGui.GetDrawData());
  scheduleFrame(loop);
}

function drawFrame(): void {
  const io = ImGui.GetIO();
  ImGui.SetNextWindowPos(new ImGui.ImVec2(0, 0));
  ImGui.SetNextWindowSize(io.DisplaySize);
  const flags = ImGui.WindowFlags.NoTitleBar | ImGui.WindowFlags.NoResize | ImGui.WindowFlags.NoMove | ImGui.WindowFlags.NoCollapse;
  ImGui.Begin('wgd-inspect', null, flags);

  if (ImGui.BeginTabBar('wgd-inspect-menu')) {
    if (ImGui.BeginTabItem('wgd-command-inspector')) {
      if (!session || session.calls.length === 0) {
        ImGui.TextColored(COLOR_DIM, 'No calls recorded yet.');
        ImGui.End();
        return;
      }

      const avail = ImGui.GetContentRegionAvail();
      const callListWidth = avail.x * 0.34;
      drawCallList(callListWidth, avail.y);
      ImGui.SameLine();
      drawRightColumn(avail.x - callListWidth - 8, avail.y);
      ImGui.EndTabItem();
    }

    if (ImGui.BeginTabItem('wgd-geometry-inspector')) {
      const avail = ImGui.GetContentRegionAvail();
      const callListWidth = avail.x * 0.34;
      drawCallList(callListWidth, avail.y);
      ImGui.SameLine();
      ImGui.EndTabItem();
    }
    ImGui.EndTabBar();
  }

  ImGui.End();
}

function summarizeArgs(call: GLCall): string {
  return call.args.map((a) => a.display).join(', ');
}

function drawCallList(width: number, height: number): void {
  ImGui.BeginChild('call-list', new ImGui.ImVec2(width, height), true);

  for (const call of session!.calls) {
    const isSelected = call.id === selectedCallId;
    const cause = redundant.get(call.id);
    const isRedundant = redundant.has(call.id);
    const flagged = isRedundant || call.threwError;
    const label = `${String(call.id).padStart(3, ' ')}  ${call.name}(${summarizeArgs(call)})${call.objectId != null ? ` -> #${call.objectId}` : ''
      }##call${call.id}`;

    if (flagged) ImGui.PushStyleColor(ImGui.Col.Text, COLOR_DANGER);
    if (ImGui.Selectable(label, isSelected)) {
      selectedCallId = call.id;
      pickedPixel = null;
    }
    if (flagged) ImGui.PopStyleColor();

    if (isRedundant && ImGui.IsItemHovered()) {
      ImGui.SetTooltip(cause != null ? `Redundant — see call #${cause}` : 'Redundant: had no effect on the final image');
    }
    if (scrollToSelected && isSelected) ImGui.SetScrollHereY();
  }

  scrollToSelected = false;
  ImGui.EndChild();
}

function drawRightColumn(width: number, height: number): void {
  ImGui.BeginChild('right-col', new ImGui.ImVec2(width, height), false);
  const previewHeight = Math.max(160, height * 0.4);
  drawPreview(width, previewHeight);
  drawStatePanel(width, height - previewHeight - ImGui.GetStyle().ItemSpacing.y);
  ImGui.EndChild();
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function drawPreview(width: number, height: number): void {
  ImGui.BeginChild('preview', new ImGui.ImVec2(width, height), true);
  ImGui.TextColored(COLOR_DIM, 'RENDER TARGET');
  ImGui.Separator();

  const snapshot: FrameSnapshot | null = thumbnails?.snapshotAt(selectedCallId) ?? null;
  if (!snapshot) {
    ImGui.TextColored(COLOR_DIM, 'No render target yet.');
  } else {
    if (previewTextureCallId !== selectedCallId) {
      if (!previewTexture) previewTexture = new ImGui_Impl.Texture();
      previewTexture.Update(snapshot.canvas);
      previewTextureCallId = selectedCallId;
    }

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

function drawStatePanel(width: number, height: number): void {
  ImGui.BeginChild('state-panel', new ImGui.ImVec2(width, Math.max(1, height)), true);

  const state: GLState = session!.getStateAt(selectedCallId);

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
