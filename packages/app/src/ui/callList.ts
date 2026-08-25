import type { GLCall } from '@wgd/core';

export type SelectHandler = (index: number) => void;

function summarizeArgs(call: GLCall): string {
  return call.args.map((a) => a.display).join(', ');
}

export class CallListView {
  private container: HTMLElement;
  private onSelect: SelectHandler;
  private selectedIndex = -1;
  private rows: HTMLElement[] = [];

  constructor(container: HTMLElement, onSelect: SelectHandler) {
    this.container = container;
    this.onSelect = onSelect;
    this.container.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.call-row');
      if (!row) return;
      const index = Number(row.dataset.index);
      this.select(index);
    });
  }

  render(calls: readonly GLCall[], redundant: ReadonlySet<number> = new Set()): void {
    this.container.innerHTML = '';
    this.rows = [];

    if (calls.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'No calls recorded yet. Click "Capture Frame".';
      this.container.appendChild(hint);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const call of calls) {
      const isRedundant = redundant.has(call.id);
      const row = document.createElement('div');
      row.className = 'call-row' + (call.threwError ? ' errored' : '') + (isRedundant ? ' redundant' : '');
      if (isRedundant) row.title = 'Redundant: overwritten before anything observed it';
      row.dataset.index = String(call.id);

      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(call.id);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = call.name;

      const args = document.createElement('span');
      args.className = 'args';
      args.textContent = `(${summarizeArgs(call)})${call.objectId ? ` -> #${call.objectId}` : ''}`;

      row.append(idx, name, args);
      fragment.appendChild(row);
      this.rows.push(row);
    }
    this.container.appendChild(fragment);

    if (this.selectedIndex >= 0 && this.selectedIndex < calls.length) {
      this.rows[this.selectedIndex].classList.add('selected');
    }
  }

  select(index: number): void {
    this.rows[this.selectedIndex]?.classList.remove('selected');
    this.selectedIndex = index;
    this.rows[index]?.classList.add('selected');
    this.rows[index]?.scrollIntoView({ block: 'nearest' });
    this.onSelect(index);
  }

  get selected(): number {
    return this.selectedIndex;
  }
}
