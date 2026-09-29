import type { DebugSession, GLCall } from '@wgd/core';
import { ImGui, ImGui_Impl } from '@zhobo63/imgui-ts';
import { clearPickedPixel, drawCommandInspector, resetCommandInspector } from './commandInspector.js';
import { drawGeometryInspector } from './geometryInspector.js';

// Immediate-mode UI: no widget objects, no view classes — just free functions
// redrawing every frame from plain module-level state. Selection and scroll
// requests live here; each inspector owns its panel-specific state.

const COLOR_BG = new ImGui.ImVec4(0.102, 0.11, 0.126, 1); // --bg
const COLOR_HEADER = new ImGui.ImVec4(0.137, 0.255, 0.388, 1); // --accent-bg
const COLOR_DIM = new ImGui.ImVec4(0.541, 0.553, 0.58, 1); // --text-dim
const COLOR_DANGER = new ImGui.ImVec4(1, 0.42, 0.42, 1); // --danger

let initPromise: Promise<void> | null = null;
let canvas: HTMLCanvasElement | null = null;
let running = false;
let scheduleFrame: (cb: FrameRequestCallback) => number = (cb) => window.requestAnimationFrame(cb);

let gl: WebGL2RenderingContext | null = null;
let session: DebugSession | null = null;
let redundant: ReadonlyMap<number, number | null> = new Map();

let selectedCallId = -1;
let scrollToSelected = false;

/** Mounts (once) and (re)populates the imgui-driven inspect UI for a freshly captured frame. */
export async function mountInspectUI(
  container: HTMLElement,
  nextGl: WebGL2RenderingContext,
  nextSession: DebugSession,
  nextRedundant: ReadonlyMap<number, number | null>,
  opts: { scheduleFrame?: (cb: FrameRequestCallback) => number } = {},
): Promise<void> {
  if (opts.scheduleFrame) scheduleFrame = opts.scheduleFrame;

  gl = nextGl;
  session = nextSession;
  redundant = nextRedundant;
  const lastCall = nextSession.calls[nextSession.calls.length - 1];
  selectedCallId = lastCall ? lastCall.id : -1;
  scrollToSelected = true;
  resetCommandInspector();

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

  if (!gl || !session || session.calls.length === 0) {
    ImGui.TextColored(COLOR_DIM, 'No calls recorded yet.');
  } else if (ImGui.BeginTabBar('wgd-inspect-menu')) {
    if (ImGui.BeginTabItem('wgd-command-inspector')) {
      const avail = ImGui.GetContentRegionAvail();
      const callListWidth = avail.x * 0.34;
      drawCallList(callListWidth, avail.y);
      ImGui.SameLine();
      drawCommandInspector(gl, session, selectedCallId, avail.x - callListWidth - 8, avail.y);
      ImGui.EndTabItem();
    }

    if (ImGui.BeginTabItem('wgd-geometry-inspector')) {
      const avail = ImGui.GetContentRegionAvail();
      const callListWidth = avail.x * 0.34;
      drawCallList(callListWidth, avail.y);
      ImGui.SameLine();
      drawGeometryInspector(gl, session, selectedCallId, avail.x - callListWidth - 8, avail.y);
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
      clearPickedPixel();
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
