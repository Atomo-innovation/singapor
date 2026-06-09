/* ══════════════════════════════════════════════════════════════════════
   VisionTrack — Drag & Drop Layout Editor
   Toggle EDIT mode to drag panels, resize columns, adjust panel heights.
══════════════════════════════════════════════════════════════════════ */
'use strict';

const COLUMN_SELECTORS = {
  left: '.col-left',
  center: '.col-center',
  right: '.col-right',
};

let editMode = false;
let columnResizers = [];
let activePointer = null;

function getPanelEl(id) {
  return document.querySelector(`[data-panel-id="${id}"]`);
}

function getColumnEl(name) {
  return document.querySelector(COLUMN_SELECTORS[name]);
}

function findDropTarget(clientX, clientY) {
  for (const col of ['left', 'center', 'right']) {
    const columnEl = getColumnEl(col);
    if (!columnEl || columnEl.offsetParent === null) continue;
    const rect = columnEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;

    const panels = [...columnEl.querySelectorAll(':scope > [data-panel-id]')].filter(
      p => !p.classList.contains('is-dragging')
    );

    for (const panel of panels) {
      const pr = panel.getBoundingClientRect();
      const midY = pr.top + pr.height / 2;
      if (clientY < midY) {
        return { column: col, columnEl, beforeId: panel.dataset.panelId, indicatorY: pr.top };
      }
    }

    return { column: col, columnEl, beforeId: null, indicatorY: rect.bottom - 4 };
  }
  return null;
}

function showDropIndicator(target) {
  removeDropIndicator();
  if (!target) return;
  const line = document.createElement('div');
  line.className = 'layout-drop-indicator';
  line.id = 'layout-drop-indicator';
  const colRect = target.columnEl.getBoundingClientRect();
  line.style.left = `${colRect.left + 6}px`;
  line.style.width = `${colRect.width - 12}px`;
  line.style.top = `${target.indicatorY}px`;
  document.body.appendChild(line);
}

function removeDropIndicator() {
  document.getElementById('layout-drop-indicator')?.remove();
}

function movePanelInConfig(panelId, column, beforeId) {
  const cfg = window.LayoutManager.getConfig();
  const order = structuredClone(cfg.panels.order);

  for (const col of Object.keys(order)) {
    order[col] = order[col].filter(id => id !== panelId);
  }
  if (!order[column]) order[column] = [];

  if (beforeId && order[column].includes(beforeId)) {
    order[column].splice(order[column].indexOf(beforeId), 0, panelId);
  } else {
    order[column].push(panelId);
  }

  window.LayoutManager.setConfig({ panels: { order }, preset: 'custom' });
}

function startPanelDrag(e, panel) {
  if (!editMode || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const panelId = panel.dataset.panelId;
  panel.classList.add('is-dragging');
  document.body.classList.add('is-panel-dragging');

  const onMove = (ev) => {
    const target = findDropTarget(ev.clientX, ev.clientY);
    showDropIndicator(target);
    activePointer = target;
  };

  const onUp = (ev) => {
    panel.classList.remove('is-dragging');
    document.body.classList.remove('is-panel-dragging');
    removeDropIndicator();

    const target = findDropTarget(ev.clientX, ev.clientY) || activePointer;
    if (target && panelId) {
      movePanelInConfig(panelId, target.column, target.beforeId);
    }

    activePointer = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    window.dispatchEvent(new CustomEvent('layout-applied'));
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function startPanelResize(e, panel) {
  if (!editMode || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const panelId = panel.dataset.panelId;
  const cfg = window.LayoutManager.getConfig();
  const startY = e.clientY;
  const startFlex = cfg.panels.flex[panelId] ?? 1;
  const columnEl = panel.parentElement;
  const colHeight = columnEl?.getBoundingClientRect().height || 600;

  panel.classList.add('is-resizing');

  const onMove = (ev) => {
    const delta = ev.clientY - startY;
    const flexDelta = (delta / colHeight) * 3;
    const nextFlex = Math.round(Math.min(2.5, Math.max(0.35, startFlex + flexDelta)) * 100) / 100;
    panel.style.flex = `${nextFlex} 1 0`;
  };

  const onUp = (ev) => {
    panel.classList.remove('is-resizing');
    const delta = ev.clientY - startY;
    const flexDelta = (delta / colHeight) * 3;
    const nextFlex = Math.round(Math.min(2.5, Math.max(0.35, startFlex + flexDelta)) * 100) / 100;

    const flexPatch = { [panelId]: nextFlex };
    const extra = {};
    if (panelId === 'traffic') extra.rightColumn = { trafficFlex: nextFlex };
    if (panelId === 'log') extra.rightColumn = { logFlex: nextFlex };

    window.LayoutManager.setConfig({ panels: { flex: flexPatch }, ...extra, preset: 'custom' });

    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    window.dispatchEvent(new CustomEvent('layout-applied'));
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function createColumnResizers() {
  const dashboard = document.querySelector('.dashboard');
  if (!dashboard || columnResizers.length) return;

  const pairs = [
    { id: 'resizer-lc', edge: 'left-center', cols: ['left', 'center'] },
    { id: 'resizer-cr', edge: 'center-right', cols: ['center', 'right'] },
  ];

  pairs.forEach(({ id, edge, cols }) => {
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    handle.id = id;
    handle.dataset.edge = edge;
    handle.title = 'Drag to resize columns';
    handle.innerHTML = '<span></span>';
    dashboard.appendChild(handle);

    handle.addEventListener('pointerdown', (e) => startColumnResize(e, edge, cols));
    columnResizers.push(handle);
  });
}

function positionColumnResizers() {
  const dashboard = document.querySelector('.dashboard');
  if (!dashboard) return;

  const dRect = dashboard.getBoundingClientRect();
  const left = getColumnEl('left');
  const center = getColumnEl('center');
  const right = getColumnEl('right');

  const lc = document.getElementById('resizer-lc');
  const cr = document.getElementById('resizer-cr');

  if (lc && left && center && left.offsetParent !== null && center.offsetParent !== null) {
    const lRect = left.getBoundingClientRect();
    const cRect = center.getBoundingClientRect();
    const x = (lRect.right + cRect.left) / 2 - dRect.left;
    lc.style.left = `${x}px`;
    lc.style.display = 'block';
  } else if (lc) {
    lc.style.display = 'none';
  }

  if (cr && center && right && center.offsetParent !== null && right.offsetParent !== null) {
    const cRect = center.getBoundingClientRect();
    const rRect = right.getBoundingClientRect();
    const x = (cRect.right + rRect.left) / 2 - dRect.left;
    cr.style.left = `${x}px`;
    cr.style.display = 'block';
  } else if (cr) {
    cr.style.display = 'none';
  }
}

function startColumnResize(e, edge, cols) {
  if (!editMode || e.button !== 0) return;
  e.preventDefault();

  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  handle.classList.add('active');

  const dashboard = document.querySelector('.dashboard');
  const startX = e.clientX;
  const cfg = window.LayoutManager.getConfig();
  const start = { ...cfg.columns };

  const onMove = (ev) => {
    const dashWidth = dashboard.getBoundingClientRect().width || 1;
    const deltaRatio = (ev.clientX - startX) / dashWidth;

    let patch = {};
    if (edge === 'left-center') {
      patch = {
        leftFr: clamp(start.leftFr + deltaRatio * 2.5, 0.4, 2),
        centerFr: clamp(start.centerFr - deltaRatio * 2.5, 0.4, 2),
      };
    } else {
      patch = {
        centerFr: clamp(start.centerFr + deltaRatio * 2.5, 0.4, 2),
        rightFr: clamp(start.rightFr - deltaRatio * 2.5, 0.4, 2),
      };
    }

    document.documentElement.style.setProperty('--grid-columns', window.LayoutManager.buildGridColumns({
      ...cfg,
      columns: { ...cfg.columns, ...patch },
    }));
  };

  const onUp = (ev) => {
    handle.classList.remove('active');
    handle.releasePointerCapture(ev.pointerId);

    const dashWidth = dashboard.getBoundingClientRect().width || 1;
    const deltaRatio = (ev.clientX - startX) / dashWidth;

    let patch = {};
    if (edge === 'left-center') {
      patch = {
        leftFr: round2(clamp(start.leftFr + deltaRatio * 2.5, 0.4, 2)),
        centerFr: round2(clamp(start.centerFr - deltaRatio * 2.5, 0.4, 2)),
      };
    } else {
      patch = {
        centerFr: round2(clamp(start.centerFr + deltaRatio * 2.5, 0.4, 2)),
        rightFr: round2(clamp(start.rightFr - deltaRatio * 2.5, 0.4, 2)),
      };
    }

    window.LayoutManager.setConfig({ columns: patch, preset: 'custom' });
    positionColumnResizers();

    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
  };

  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function bindPanelHandles() {
  document.querySelectorAll('[data-panel-id]').forEach(panel => {
    const dragHandle = panel.querySelector('.panel-drag-handle');
    dragHandle?.addEventListener('pointerdown', (e) => startPanelDrag(e, panel));

    let resizeHandle = panel.querySelector('.panel-resize-handle');
    if (panel.dataset.resizable !== 'false' && !resizeHandle) {
      resizeHandle = document.createElement('div');
      resizeHandle.className = 'panel-resize-handle';
      resizeHandle.title = 'Drag to resize height';
      panel.appendChild(resizeHandle);
    }
    if (panel.dataset.resizable !== 'false') {
      resizeHandle?.addEventListener('pointerdown', (e) => startPanelResize(e, panel));
    }
  });
}

function toggleEditMode(force) {
  editMode = typeof force === 'boolean' ? force : !editMode;
  document.body.classList.toggle('layout-edit-mode', editMode);

  const btn = document.getElementById('layout-edit-btn');
  btn?.classList.toggle('active', editMode);
  btn?.setAttribute('aria-pressed', String(editMode));

  const banner = document.getElementById('layout-edit-banner');
  banner?.classList.toggle('visible', editMode);

  if (editMode) {
    createColumnResizers();
    positionColumnResizers();
  }

  window.dispatchEvent(new CustomEvent('layout-edit-mode', { detail: { active: editMode } }));
}

function initLayoutDrag() {
  document.getElementById('layout-edit-btn')?.addEventListener('click', () => toggleEditMode());
  document.getElementById('layout-edit-done')?.addEventListener('click', () => toggleEditMode(false));
  document.getElementById('layout-edit-open-btn')?.addEventListener('click', () => {
    toggleEditMode(true);
    document.getElementById('layout-panel')?.classList.remove('open');
    document.getElementById('layout-backdrop')?.classList.remove('open');
    document.body.classList.remove('layout-panel-open');
  });

  bindPanelHandles();

  window.addEventListener('layout-applied', () => {
    if (editMode) positionColumnResizers();
  });

  window.addEventListener('resize', () => {
    if (editMode) positionColumnResizers();
  });
}

window.LayoutDrag = { toggleEditMode, isEditMode: () => editMode };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLayoutDrag);
} else {
  initLayoutDrag();
}
