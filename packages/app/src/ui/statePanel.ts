import type { GLState } from '@wgd/core';

type Cell = string | { text: string; kind?: 'obj' | 'null' | 'cap-on' | 'cap-off' };

function objCell(ref: { id: number; type: string } | null): Cell {
  if (!ref) return { text: 'null', kind: 'null' };
  return { text: `${ref.type}#${ref.id}`, kind: 'obj' };
}

function enumCell(e: { name: string; raw: number }): string {
  return e.name;
}

function renderTable(container: HTMLElement, rows: Array<[string, Cell]>): void {
  const table = document.createElement('table');
  table.className = 'state-table';
  for (const [key, cell] of rows) {
    const tr = document.createElement('tr');
    const tdKey = document.createElement('td');
    tdKey.className = 'key';
    tdKey.textContent = key;
    const tdVal = document.createElement('td');
    tdVal.className = 'val';
    if (typeof cell === 'string') {
      tdVal.textContent = cell;
    } else {
      tdVal.textContent = cell.text;
      if (cell.kind) tdVal.classList.add(cell.kind === 'obj' ? 'obj-ref' : cell.kind === 'null' ? 'null-val' : cell.kind);
    }
    tr.append(tdKey, tdVal);
    table.appendChild(tr);
  }
  container.appendChild(table);
}

function section(container: HTMLElement, title: string, build: (body: HTMLElement) => void): void {
  const sec = document.createElement('div');
  sec.className = 'state-section';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  sec.appendChild(h3);
  build(sec);
  container.appendChild(sec);
}

export function renderStatePanel(container: HTMLElement, state: GLState): void {
  container.innerHTML = '';

  section(container, 'Buffer Bindings', (el) =>
    renderTable(
      el,
      Object.entries(state.bufferBindings).map(([k, v]) => [k, objCell(v)]),
    ),
  );

  section(container, `Textures (active unit ${state.activeTextureUnit})`, (el) => {
    state.textureUnits.forEach((unit, i) => {
      const rows: Array<[string, Cell]> = Object.entries(unit).map(([k, v]) => [`[${i}] ${k}`, objCell(v)]);
      renderTable(el, rows);
    });
  });

  section(container, 'Program & Framebuffer', (el) =>
    renderTable(el, [
      ['CURRENT_PROGRAM', objCell(state.currentProgram)],
      ['DRAW_FRAMEBUFFER', objCell(state.framebufferBindings.DRAW_FRAMEBUFFER)],
      ['READ_FRAMEBUFFER', objCell(state.framebufferBindings.READ_FRAMEBUFFER)],
      ['RENDERBUFFER', objCell(state.renderbufferBinding)],
      ['VERTEX_ARRAY', objCell(state.vertexArrayBinding)],
    ]),
  );

  section(container, 'Vertex Attribs', (el) => {
    if (state.vertexAttribs.length === 0) {
      const p = document.createElement('div');
      p.className = 'null-val';
      p.textContent = '(none configured)';
      el.appendChild(p);
      return;
    }
    const rows: Array<[string, Cell]> = state.vertexAttribs.map((a, i) => [
      `[${i}]`,
      `${a.enabled ? 'enabled' : 'disabled'} size=${a.size} type=${a.type ? enumCell(a.type) : '-'} stride=${a.stride} offset=${a.offset} buffer=${a.buffer ? `${a.buffer.type}#${a.buffer.id}` : 'null'}`,
    ]);
    renderTable(el, rows);
  });

  section(container, 'Viewport & Scissor', (el) =>
    renderTable(el, [
      ['VIEWPORT', `${state.viewport.x}, ${state.viewport.y}, ${state.viewport.width}x${state.viewport.height}`],
      ['SCISSOR_BOX', `${state.scissorBox.x}, ${state.scissorBox.y}, ${state.scissorBox.width}x${state.scissorBox.height}`],
      ['SCISSOR_TEST', state.capabilities.SCISSOR_TEST ? { text: 'on', kind: 'cap-on' } : { text: 'off', kind: 'cap-off' }],
    ]),
  );

  section(container, 'Clear Values', (el) =>
    renderTable(el, [
      ['COLOR_CLEAR_VALUE', state.clearColor.join(', ')],
      ['DEPTH_CLEAR_VALUE', String(state.clearDepth)],
      ['STENCIL_CLEAR_VALUE', String(state.clearStencil)],
    ]),
  );

  section(container, 'Capabilities', (el) =>
    renderTable(
      el,
      Object.entries(state.capabilities).map(([k, v]) => [k, v ? { text: 'on', kind: 'cap-on' } : { text: 'off', kind: 'cap-off' }]),
    ),
  );

  section(container, 'Blend', (el) =>
    renderTable(el, [
      ['SRC_RGB / DST_RGB', `${enumCell(state.blend.srcRGB)} / ${enumCell(state.blend.dstRGB)}`],
      ['SRC_ALPHA / DST_ALPHA', `${enumCell(state.blend.srcAlpha)} / ${enumCell(state.blend.dstAlpha)}`],
      ['EQUATION_RGB / ALPHA', `${enumCell(state.blend.equationRGB)} / ${enumCell(state.blend.equationAlpha)}`],
    ]),
  );

  section(container, 'Depth & Cull', (el) =>
    renderTable(el, [
      ['DEPTH_FUNC', enumCell(state.depth.func)],
      ['DEPTH_WRITEMASK', String(state.depth.mask)],
      ['CULL_FACE_MODE', enumCell(state.cull.mode)],
      ['FRONT_FACE', enumCell(state.cull.frontFace)],
    ]),
  );

  const pixelStoreEntries = Object.entries(state.pixelStore);
  if (pixelStoreEntries.length > 0) {
    section(container, 'Pixel Store', (el) => renderTable(el, pixelStoreEntries.map(([k, v]) => [k, String(v)])));
  }
}
