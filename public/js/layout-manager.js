/* ══════════════════════════════════════════════════════════════════════
   VisionTrack — Layout Manager
   Edit public/config/layout.json or use the LAYOUT panel in the UI.
   User overrides persist in localStorage (key: vt-layout-config).
══════════════════════════════════════════════════════════════════════ */
'use strict';

const LAYOUT_STORAGE_KEY = 'vt-layout-config';

const DEFAULT_PANELS = {
  order: {
    left: ['sex', 'age', 'origin'],
    center: ['video'],
    right: ['traffic', 'log'],
  },
  flex: {
    sex: 0,
    age: 1,
    origin: 1,
    video: 0,
    traffic: 1,
    log: 1.15,
  },
};

const LAYOUT_PRESETS = {
  balanced: {
    preset: 'balanced',
    columns: { leftMin: 290, leftFr: 1.05, centerMin: 520, centerFr: 0.92, rightMin: 310, rightFr: 1.08 },
    visibility: { left: true, center: true, right: true },
    video: { aspectW: 16, aspectH: 9, widthPercent: 100, fit: 'contain' },
    typography: { baseSize: 13, kpiSize: 22, donutSize: 168, donutValSize: 28, chartFontSize: 11, logFontSize: 12, panelTitleSize: 11, sexBarValSize: 14 },
    spacing: { gridGap: 10, padding: 10 },
    rightColumn: { trafficFlex: 1, logFlex: 1.15 },
    panels: structuredClone(DEFAULT_PANELS),
  },
  analytics: {
    preset: 'analytics',
    columns: { leftMin: 320, leftFr: 1.25, centerMin: 400, centerFr: 0.65, rightMin: 340, rightFr: 1.35 },
    visibility: { left: true, center: true, right: true },
    video: { aspectW: 16, aspectH: 9, widthPercent: 95, fit: 'contain' },
    typography: { baseSize: 14, kpiSize: 24, donutSize: 190, donutValSize: 32, chartFontSize: 12, logFontSize: 13, panelTitleSize: 12, sexBarValSize: 15 },
    spacing: { gridGap: 10, padding: 10 },
    rightColumn: { trafficFlex: 0.9, logFlex: 1.4 },
    panels: structuredClone(DEFAULT_PANELS),
  },
  video: {
    preset: 'video',
    columns: { leftMin: 240, leftFr: 0.85, centerMin: 640, centerFr: 1.35, rightMin: 260, rightFr: 0.9 },
    visibility: { left: true, center: true, right: true },
    video: { aspectW: 16, aspectH: 9, widthPercent: 100, fit: 'cover' },
    typography: { baseSize: 12, kpiSize: 18, donutSize: 140, donutValSize: 22, chartFontSize: 10, logFontSize: 11, panelTitleSize: 10, sexBarValSize: 12 },
    spacing: { gridGap: 8, padding: 8 },
    rightColumn: { trafficFlex: 1, logFlex: 1 },
    panels: structuredClone(DEFAULT_PANELS),
  },
  compact: {
    preset: 'compact',
    columns: { leftMin: 220, leftFr: 0.9, centerMin: 480, centerFr: 1, rightMin: 240, rightFr: 0.95 },
    visibility: { left: true, center: true, right: true },
    video: { aspectW: 16, aspectH: 9, widthPercent: 100, fit: 'contain' },
    typography: { baseSize: 11, kpiSize: 16, donutSize: 120, donutValSize: 20, chartFontSize: 9, logFontSize: 10, panelTitleSize: 9, sexBarValSize: 11 },
    spacing: { gridGap: 6, padding: 6 },
    rightColumn: { trafficFlex: 1, logFlex: 1.1 },
    panels: structuredClone(DEFAULT_PANELS),
  },
};

const DEFAULT_LAYOUT = structuredClone(LAYOUT_PRESETS.balanced);

let currentConfig = structuredClone(DEFAULT_LAYOUT);

function deepMerge(base, patch) {
  const out = structuredClone(base);
  for (const key of Object.keys(patch || {})) {
    if (patch[key] && typeof patch[key] === 'object' && !Array.isArray(patch[key])) {
      out[key] = deepMerge(out[key] || {}, patch[key]);
    } else {
      out[key] = patch[key];
    }
  }
  return out;
}

function ensurePanelsConfig(cfg) {
  const panels = structuredClone(DEFAULT_PANELS);
  if (cfg.panels?.order) {
    for (const col of Object.keys(panels.order)) {
      panels.order[col] = cfg.panels.order[col] || panels.order[col];
    }
  }
  if (cfg.panels?.flex) {
    panels.flex = { ...panels.flex, ...cfg.panels.flex };
  }
  if (cfg.rightColumn) {
    panels.flex.traffic = cfg.rightColumn.trafficFlex ?? panels.flex.traffic;
    panels.flex.log = cfg.rightColumn.logFlex ?? panels.flex.log;
  }
  return panels;
}

function applyPanelLayout(cfg) {
  if (!document.querySelector('.dashboard')) return;

  const panels = ensurePanelsConfig(cfg);
  const colMap = { left: '.col-left', center: '.col-center', right: '.col-right' };

  for (const [col, ids] of Object.entries(panels.order)) {
    const container = document.querySelector(colMap[col]);
    if (!container) continue;
    ids.forEach(id => {
      const el = document.querySelector(`[data-panel-id="${id}"]`);
      if (el) container.appendChild(el);
    });
  }

  Object.entries(panels.flex).forEach(([id, flexVal]) => {
    const el = document.querySelector(`[data-panel-id="${id}"]`);
    if (!el) return;
    const grow = flexVal > 0;
    el.style.flex = grow ? `${flexVal} 1 0` : '0 1 auto';
    el.classList.toggle('panel-flex', grow);
    el.dataset.resizable = grow ? 'true' : 'false';
  });
}

function buildGridColumns(cfg) {
  const { columns, visibility } = cfg;
  const parts = [];
  if (visibility.left) parts.push(`minmax(${columns.leftMin}px, ${columns.leftFr}fr)`);
  if (visibility.center) parts.push(`minmax(${columns.centerMin}px, ${columns.centerFr}fr)`);
  if (visibility.right) parts.push(`minmax(${columns.rightMin}px, ${columns.rightFr}fr)`);
  return parts.length ? parts.join(' ') : '1fr';
}

function applyLayout(cfg) {
  cfg = structuredClone(cfg);
  cfg.panels = ensurePanelsConfig(cfg);
  cfg.rightColumn = {
    trafficFlex: cfg.panels.flex.traffic,
    logFlex: cfg.panels.flex.log,
  };

  currentConfig = cfg;
  const root = document.documentElement;
  const { columns, visibility, video, typography, spacing } = cfg;

  root.style.setProperty('--grid-columns', buildGridColumns(cfg));
  root.style.setProperty('--grid-gap', `${spacing.gridGap}px`);
  root.style.setProperty('--dash-padding', `${spacing.padding}px`);

  root.style.setProperty('--video-aspect-w', String(video.aspectW));
  root.style.setProperty('--video-aspect-h', String(video.aspectH));
  root.style.setProperty('--video-width-pct', String(video.widthPercent));
  root.style.setProperty('--video-fit', video.fit);

  root.style.setProperty('--base-font', `${typography.baseSize}px`);
  root.style.setProperty('--kpi-font', `${typography.kpiSize}px`);
  root.style.setProperty('--donut-size', `${typography.donutSize}px`);
  root.style.setProperty('--donut-val-font', `${typography.donutValSize}px`);
  root.style.setProperty('--chart-font', `${typography.chartFontSize}px`);
  root.style.setProperty('--log-font', `${typography.logFontSize}px`);
  root.style.setProperty('--panel-title-font', `${typography.panelTitleSize}px`);
  root.style.setProperty('--sex-bar-val-font', `${typography.sexBarValSize}px`);

  const dashboard = document.querySelector('.dashboard');
  if (dashboard) {
    dashboard.classList.toggle('hide-left', !visibility.left);
    dashboard.classList.toggle('hide-center', !visibility.center);
    dashboard.classList.toggle('hide-right', !visibility.right);
  }

  applyPanelLayout(cfg);

  window.dispatchEvent(new CustomEvent('layout-applied', { detail: cfg }));
}

function saveToStorage(cfg) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(cfg));
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function loadRemoteDefaults() {
  try {
    const res = await fetch('/config/layout.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function getConfig() {
  return structuredClone(currentConfig);
}

function setConfig(partial, { persist = true } = {}) {
  const next = deepMerge(currentConfig, partial);
  applyLayout(next);
  if (persist) saveToStorage(next);
  syncPanelControls(next);
  return next;
}

function applyPreset(name) {
  const preset = LAYOUT_PRESETS[name];
  if (!preset) return;
  setConfig(structuredClone(preset));
}

function resetLayout() {
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
  loadRemoteDefaults().then(remote => {
    let cfg = structuredClone(DEFAULT_LAYOUT);
    if (remote) cfg = deepMerge(cfg, remote);
    applyLayout(cfg);
    syncPanelControls(currentConfig);
  });
}

function exportLayout() {
  const blob = new Blob([JSON.stringify(currentConfig, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'visiontrack-layout.json';
  a.click();
  URL.revokeObjectURL(url);
}

function bindRange(id, path, transform = { read: v => v, write: v => v }) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    const val = transform.read(parseFloat(el.value));
    const patch = { preset: 'custom' };
    const keys = path.split('.');
    let node = patch;
    keys.forEach((k, i) => {
      if (i === keys.length - 1) node[k] = val;
      else node = node[k] = {};
    });
    setConfig(patch);
  });
}

function setRange(id, value, displayId) {
  const el = document.getElementById(id);
  if (el) el.value = value;
  if (displayId) {
    const d = document.getElementById(displayId);
    if (d) d.textContent = value;
  }
}

function syncPanelControls(cfg) {
  const c = cfg.columns;
  const v = cfg.video;
  const t = cfg.typography;
  const s = cfg.spacing;
  const r = cfg.rightColumn;

  setRange('cfg-left-fr', c.leftFr, 'val-left-fr');
  setRange('cfg-center-fr', c.centerFr, 'val-center-fr');
  setRange('cfg-right-fr', c.rightFr, 'val-right-fr');
  setRange('cfg-left-min', c.leftMin, 'val-left-min');
  setRange('cfg-center-min', c.centerMin, 'val-center-min');
  setRange('cfg-right-min', c.rightMin, 'val-right-min');

  setRange('cfg-video-width', v.widthPercent, 'val-video-width');
  setRange('cfg-kpi-size', t.kpiSize, 'val-kpi-size');
  setRange('cfg-donut-size', t.donutSize, 'val-donut-size');
  setRange('cfg-chart-font', t.chartFontSize, 'val-chart-font');
  setRange('cfg-log-font', t.logFontSize, 'val-log-font');
  setRange('cfg-grid-gap', s.gridGap, 'val-grid-gap');
  setRange('cfg-traffic-flex', r.trafficFlex, 'val-traffic-flex');
  setRange('cfg-log-flex', r.logFlex, 'val-log-flex');

  const aspectEl = document.getElementById('cfg-video-aspect');
  if (aspectEl) aspectEl.value = `${v.aspectW}:${v.aspectH}`;

  const fitEl = document.getElementById('cfg-video-fit');
  if (fitEl) fitEl.value = v.fit;

  ['left', 'center', 'right'].forEach(col => {
    const cb = document.getElementById(`cfg-show-${col}`);
    if (cb) cb.checked = cfg.visibility[col];
  });

  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === cfg.preset);
  });
}

function initLayoutPanel() {
  const panel = document.getElementById('layout-panel');
  const openBtn = document.getElementById('layout-open-btn');
  const closeBtn = document.getElementById('layout-close-btn');
  const backdrop = document.getElementById('layout-backdrop');

  if (!panel) return;

  const toggle = (open) => {
    panel.classList.toggle('open', open);
    backdrop?.classList.toggle('open', open);
    document.body.classList.toggle('layout-panel-open', open);
  };

  openBtn?.addEventListener('click', () => toggle(true));
  closeBtn?.addEventListener('click', () => toggle(false));
  backdrop?.addEventListener('click', () => toggle(false));

  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  document.getElementById('layout-reset-btn')?.addEventListener('click', resetLayout);
  document.getElementById('layout-export-btn')?.addEventListener('click', exportLayout);

  bindRange('cfg-left-fr', 'columns.leftFr', { read: v => v, write: v => v });
  bindRange('cfg-center-fr', 'columns.centerFr', { read: v => v, write: v => v });
  bindRange('cfg-right-fr', 'columns.rightFr', { read: v => v, write: v => v });
  bindRange('cfg-left-min', 'columns.leftMin', { read: v => v, write: v => v });
  bindRange('cfg-center-min', 'columns.centerMin', { read: v => v, write: v => v });
  bindRange('cfg-right-min', 'columns.rightMin', { read: v => v, write: v => v });
  bindRange('cfg-video-width', 'video.widthPercent', { read: v => v, write: v => v });
  bindRange('cfg-kpi-size', 'typography.kpiSize', { read: v => v, write: v => v });
  bindRange('cfg-donut-size', 'typography.donutSize', { read: v => v, write: v => v });
  bindRange('cfg-chart-font', 'typography.chartFontSize', { read: v => v, write: v => v });
  bindRange('cfg-log-font', 'typography.logFontSize', { read: v => v, write: v => v });
  bindRange('cfg-grid-gap', 'spacing.gridGap', { read: v => v, write: v => v });
  bindRange('cfg-traffic-flex', 'rightColumn.trafficFlex', { read: v => v, write: v => v });
  bindRange('cfg-log-flex', 'rightColumn.logFlex', { read: v => v, write: v => v });

  document.querySelectorAll('.layout-range').forEach(range => {
    range.addEventListener('input', () => {
      const display = document.getElementById(range.dataset.display);
      if (display) display.textContent = range.value;
    });
  });

  document.getElementById('cfg-video-aspect')?.addEventListener('change', e => {
    const [w, h] = e.target.value.split(':').map(Number);
    setConfig({ video: { aspectW: w, aspectH: h }, preset: 'custom' });
  });

  document.getElementById('cfg-video-fit')?.addEventListener('change', e => {
    setConfig({ video: { fit: e.target.value }, preset: 'custom' });
  });

  ['left', 'center', 'right'].forEach(col => {
    document.getElementById(`cfg-show-${col}`)?.addEventListener('change', e => {
      setConfig({ visibility: { [col]: e.target.checked }, preset: 'custom' });
    });
  });

  syncPanelControls(currentConfig);
}

async function initLayoutManager() {
  let cfg = getConfig();
  const remote = await loadRemoteDefaults();
  if (remote) {
    cfg = deepMerge(structuredClone(DEFAULT_LAYOUT), remote);
    const stored = loadFromStorage();
    if (stored) cfg = deepMerge(cfg, stored);
  }
  applyLayout(cfg);
  initLayoutPanel();
}

window.LayoutManager = {
  getConfig,
  setConfig,
  applyPreset,
  resetLayout,
  exportLayout,
  buildGridColumns,
  PRESETS: Object.keys(LAYOUT_PRESETS),
};

// Apply stored layout immediately so dashboard renders with correct sizes
(function bootstrapLayout() {
  let cfg = structuredClone(DEFAULT_LAYOUT);
  const stored = loadFromStorage();
  if (stored) cfg = deepMerge(cfg, stored);
  applyLayout(cfg);
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLayoutManager);
} else {
  initLayoutManager();
}
