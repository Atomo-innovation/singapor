/* ══════════════════════════════════════════════════════════════════════
   VisionTrack — Dashboard Client
══════════════════════════════════════════════════════════════════════ */
'use strict';

// ── Clock ─────────────────────────────────────────────────────────────
const clockTimeEl = document.getElementById('clock-time');
const clockDateEl = document.getElementById('clock-date');
function updateClock() {
  const now = new Date();
  clockTimeEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  clockDateEl.textContent = now.toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: '2-digit'
  }).toUpperCase();
}
updateClock();
setInterval(updateClock, 1000);

// Frame counter
let frame = 0;
const frameEl = document.getElementById('frame-counter');
setInterval(() => {
  frame++;
  frameEl.textContent = String(frame).padStart(6, '0');
}, 33);

// ── Video placeholder hide on load ────────────────────────────────────
const videoEl = document.getElementById('feed-video');
const placeholder = document.getElementById('video-placeholder');
videoEl.addEventListener('canplay', () => {
  placeholder.style.display = 'none';
});

// ── Chart.js global defaults ──────────────────────────────────────────
function getChartFontSize() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--chart-font').trim();
  return parseInt(v, 10) || 11;
}

Chart.defaults.color           = '#4a5568';
Chart.defaults.font.family     = "'JetBrains Mono', monospace";
Chart.defaults.font.size       = getChartFontSize();
Chart.defaults.plugins.legend.display = false;

const chartInstances = [];
function registerChart(chart) { chartInstances.push(chart); }

function refreshChartsForLayout() {
  const size = getChartFontSize();
  Chart.defaults.font.size = size;
  chartInstances.forEach(chart => {
    if (chart.options.scales) {
      Object.values(chart.options.scales).forEach(scale => {
        if (scale.ticks?.font) scale.ticks.font.size = size;
        else if (scale.ticks) scale.ticks.font = { size };
      });
    }
    chart.resize();
    if (chart === trafficChart) refreshTrafficLineStyle();
    chart.update('none');
  });
}

window.addEventListener('layout-applied', refreshChartsForLayout);

const CYAN    = '#00d4ff';
const PURPLE  = '#8b5cf6';
const PINK    = '#f43f5e';
const GREEN   = '#10b981';
const YELLOW  = '#f59e0b';
const ORANGE  = '#f97316';

const GRID_COLOR = 'rgba(0,200,255,0.05)';
const HOURS = ['12a','1a','2a','3a','4a','5a','6a','7a','8a','9a','10a','11a',
               '12p','1p','2p','3p','4p','5p','6p','7p','8p','9p','10p','11p'];
const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── Traffic Chart (line) ──────────────────────────────────────────────
const trafficCtx = document.getElementById('traffic-chart').getContext('2d');

function buildTrafficGradient() {
  const h = trafficCtx.canvas.parentElement?.clientHeight || 200;
  const grad = trafficCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,212,255,0.35)');
  grad.addColorStop(1, 'rgba(0,212,255,0.02)');
  return grad;
}

const trafficChart = new Chart(trafficCtx, {
  type: 'line',
  data: {
    labels: HOURS,
    datasets: [{
      label: 'Foot traffic',
      data: Array(24).fill(0),
      borderColor: CYAN,
      backgroundColor: buildTrafficGradient(),
      fill: true,
      tension: 0.35,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 6,
      pointBackgroundColor: CYAN,
      pointBorderColor: '#0e1320',
      pointBorderWidth: 2,
      pointHitRadius: 12,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        grid: { color: GRID_COLOR, drawBorder: false },
        ticks: { maxRotation: 0, font: { size: getChartFontSize() } },
      },
      y: {
        grid: { color: GRID_COLOR, drawBorder: false },
        ticks: { precision: 0, font: { size: getChartFontSize() + 1 } },
        beginAtZero: true,
      }
    },
    plugins: {
      tooltip: {
        backgroundColor: 'rgba(6,8,16,0.92)',
        borderColor: 'rgba(0,212,255,0.3)',
        borderWidth: 1,
        titleFont: { family: "'JetBrains Mono', monospace", size: getChartFontSize() },
        bodyFont:  { family: "'JetBrains Mono', monospace", size: getChartFontSize() },
        callbacks: { label: ctx => ` ${ctx.parsed.y} people` }
      }
    }
  }
});
registerChart(trafficChart);

function refreshTrafficLineStyle() {
  const ds = trafficChart.data.datasets[0];
  ds.backgroundColor = buildTrafficGradient();
  const hour = new Date().getHours();
  ds.pointRadius = trafficChart.data.labels.length === 24
    ? trafficChart.data.labels.map((_, i) => (i === hour ? 5 : 0))
    : trafficChart.data.labels.map(() => 4);
}

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    renderTrafficChart(lastState);
  });
});
let currentTab = 'hourly';

function renderTrafficChart(state) {
  if (!state) return;
  if (currentTab === 'hourly') {
    trafficChart.data.labels = HOURS;
    trafficChart.data.datasets[0].data = state.hourlyData;
  } else {
    trafficChart.data.labels = DAYS;
    trafficChart.data.datasets[0].data = state.dailyData;
  }
  refreshTrafficLineStyle();
  trafficChart.update('none');
}

// ── Sex Donut ─────────────────────────────────────────────────────────
const sexCtx = document.getElementById('sex-chart').getContext('2d');
const sexChart = new Chart(sexCtx, {
  type: 'doughnut',
  data: {
    labels: ['Male','Female'],
    datasets: [{
      data: [1,1],
      backgroundColor: [CYAN, PINK],
      borderColor: '#0e1320',
      borderWidth: 4,
      hoverOffset: 3,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: true,
    cutout: '72%',
    animation: { duration: 500 },
    plugins: {
      tooltip: {
        backgroundColor: 'rgba(6,8,16,0.92)',
        borderColor: 'rgba(0,212,255,0.3)',
        borderWidth: 1,
        callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` }
      }
    }
  }
});
registerChart(sexChart);

function renderSexBars(data) {
  const total = (data.Male + data.Female) || 1;
  const mPct  = Math.round(data.Male   / total * 100);
  const fPct  = Math.round(data.Female / total * 100);
  document.getElementById('sex-pct').textContent = mPct + '%';
  document.getElementById('sex-bars').innerHTML = `
    <div class="sex-bar-item">
      <div class="sex-bar-hd">
        <span class="sex-bar-label">MALE</span>
        <span class="sex-bar-val">${mPct}% <span style="color:var(--text3)">(${data.Male})</span></span>
      </div>
      <div class="sex-bar-track"><div class="sex-bar-fill" style="width:${mPct}%;background:var(--cyan)"></div></div>
    </div>
    <div class="sex-bar-item">
      <div class="sex-bar-hd">
        <span class="sex-bar-label">FEMALE</span>
        <span class="sex-bar-val">${fPct}% <span style="color:var(--text3)">(${data.Female})</span></span>
      </div>
      <div class="sex-bar-track"><div class="sex-bar-fill" style="width:${fPct}%;background:var(--pink)"></div></div>
    </div>
  `;
}

// ── Age Chart ─────────────────────────────────────────────────────────
const AGE_LABELS   = ['0–17','18–25','26–35','36–50','51–65','65+'];
const AGE_COLORS   = [PURPLE,'rgba(0,212,255,0.9)','rgba(0,212,255,0.7)',
                      'rgba(0,212,255,0.5)','rgba(100,116,139,0.6)','rgba(100,116,139,0.4)'];
const ageCtx = document.getElementById('age-chart').getContext('2d');
const ageChart = new Chart(ageCtx, {
  type: 'bar',
  data: {
    labels: AGE_LABELS,
    datasets: [{ data: Array(6).fill(0), backgroundColor: AGE_COLORS, borderRadius: 3, borderSkipped: false, maxBarThickness: 18 }]
  },
  options: {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    animation: { duration: 300 },
    scales: {
      x: { grid: { color: GRID_COLOR, drawBorder: false }, beginAtZero: true, ticks: { precision: 0, font: { size: getChartFontSize() } } },
      y: { grid: { display: false }, ticks: { font: { size: getChartFontSize() + 1 } } },
    },
    plugins: { tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} people` } } }
  }
});
registerChart(ageChart);

// ── Origin Chart ──────────────────────────────────────────────────────
const ORIGIN_LABELS = ['S. Asian','E. Asian','Mid. East','African','European','American','Other'];
const originCtx = document.getElementById('origin-chart').getContext('2d');
const originChart = new Chart(originCtx, {
  type: 'bar',
  data: {
    labels: ORIGIN_LABELS,
    datasets: [{
      data: Array(7).fill(0),
      backgroundColor: ctx => {
        const alpha = 0.2 + (1 - ctx.dataIndex / 7) * 0.65;
        return `rgba(0,212,255,${alpha.toFixed(2)})`;
      },
      hoverBackgroundColor: CYAN,
      borderRadius: 3, borderSkipped: false,
      maxBarThickness: 16,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    animation: { duration: 300 },
    scales: {
      x: { grid: { color: GRID_COLOR, drawBorder: false }, beginAtZero: true, ticks: { precision: 0, font: { size: getChartFontSize() } } },
      y: { grid: { display: false }, ticks: { font: { size: getChartFontSize() + 1 } } },
    },
    plugins: { tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} people` } } }
  }
});
registerChart(originChart);

// ── Detection canvas overlay ──────────────────────────────────────────
const canvas = document.getElementById('detection-canvas');
const ctx2d  = canvas.getContext('2d');
let overlayBoxes = [];

function syncCanvas() {
  canvas.width  = videoEl.offsetWidth;
  canvas.height = videoEl.offsetHeight;
}
const videoWrap = document.querySelector('.video-wrap');
new ResizeObserver(syncCanvas).observe(videoEl);
if (videoWrap) new ResizeObserver(syncCanvas).observe(videoWrap);
window.addEventListener('layout-applied', syncCanvas);
syncCanvas();

function drawOverlay() {
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);

  overlayBoxes.forEach(b => {
    const x = b.x * canvas.width,  y = b.y * canvas.height;
    const w = b.w * canvas.width,  h = b.h * canvas.height;
    const color = b.sex === 'Male' ? '#00d4ff' : '#f43f5e';

    // Main box — thin
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 1;
    ctx2d.globalAlpha = 0.55;
    ctx2d.strokeRect(x, y, w, h);
    ctx2d.globalAlpha = 1;

    // Corner ticks — bright
    const T = 12;
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 2;
    const corners = [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]];
    corners.forEach(([cx,cy,sx,sy]) => {
      ctx2d.beginPath();
      ctx2d.moveTo(cx + sx*T, cy);
      ctx2d.lineTo(cx, cy);
      ctx2d.lineTo(cx, cy + sy*T);
      ctx2d.stroke();
    });

    // Label
    const pct  = Math.round(b.conf * 100);
    const label = `${b.sex[0]} · ${b.age} · ${pct}%`;
    ctx2d.font = 'bold 9px "JetBrains Mono", monospace';
    const tw = ctx2d.measureText(label).width + 10;

    ctx2d.fillStyle = 'rgba(6,8,16,0.8)';
    ctx2d.fillRect(x, y - 17, tw, 15);
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 0.5;
    ctx2d.strokeRect(x, y - 17, tw, 15);

    ctx2d.fillStyle = color;
    ctx2d.fillText(label, x + 5, y - 6);

    // Confidence micro-bar
    ctx2d.fillStyle = 'rgba(255,255,255,0.1)';
    ctx2d.fillRect(x, y + h, w, 3);
    ctx2d.fillStyle = color;
    ctx2d.fillRect(x, y + h, w * b.conf, 3);
  });

  requestAnimationFrame(drawOverlay);
}
drawOverlay();

function buildOverlay(activePeople, detections) {
  const count = Math.min(activePeople, 8);
  overlayBoxes = [];
  for (let i = 0; i < count; i++) {
    const d = detections[i] || {};
    const col = i % 3, row = Math.floor(i / 3);
    overlayBoxes.push({
      x: 0.04 + col * 0.30 + (Math.sin(i * 1.3 + Date.now()/8000) * 0.03),
      y: 0.08 + row * 0.44 + (Math.cos(i * 0.9 + Date.now()/9000) * 0.02),
      w: 0.17 + (i % 2) * 0.04,
      h: 0.34 + (i % 3) * 0.04,
      sex:  d.sex  || (Math.random() > 0.5 ? 'Male' : 'Female'),
      age:  d.age  || '26–35',
      conf: d.confidence || 0.88,
    });
  }
}

// ── Detection log ─────────────────────────────────────────────────────
const logEl = document.getElementById('detection-log');

function renderLog(detections) {
  if (!detections || detections.length === 0) return;
  const rows = detections.slice(0, 30).map(d => {
    const t = new Date(d.ts).toLocaleTimeString('en-US', { hour12: false });
    const pct = Math.round(d.confidence * 100);
    const confClass = pct >= 85 ? 'conf-hi' : pct >= 65 ? 'conf-mid' : 'conf-lo';
    const sexClass  = d.sex === 'Male' ? 'M' : 'F';
    return `
      <div class="log-row">
        <span class="log-ts">${t}</span>
        <span class="log-sex ${sexClass}">${d.sex[0]}</span>
        <span class="log-age">${d.age}</span>
        <span class="log-orig">${d.origin}</span>
        <span class="log-conf ${confClass}">${pct}%</span>
      </div>`;
  }).join('');
  logEl.innerHTML = rows;
}

// ── Socket.IO ─────────────────────────────────────────────────────────
const socket = io();
let lastState = null;
let confHistory = [];

socket.on('detection_update', state => {
  lastState = state;

  // KPI header
  document.getElementById('active-count').textContent = state.activePeople;
  document.getElementById('total-count').textContent  = state.totalToday.toLocaleString();

  // Confidence avg (rolling)
  if (state.detections && state.detections.length) {
    const latest = state.detections.slice(0, 10).map(d => d.confidence);
    confHistory = [...latest, ...confHistory].slice(0, 30);
    const avg = confHistory.reduce((a,b) => a+b, 0) / confHistory.length;
    document.getElementById('conf-avg').textContent    = Math.round(avg * 100) + '%';
    document.getElementById('conf-hud').textContent    = Math.round(avg * 100) + '%';
  }

  // HUD
  document.getElementById('det-count-hud').textContent = `${state.activePeople} SUBJECTS`;

  // Last detect time
  if (state.detections && state.detections[0]) {
    const t = new Date(state.detections[0].ts).toLocaleTimeString('en-US', { hour12: false });
    document.getElementById('last-det-time').textContent = `LAST DETECT: ${t}`;
  }

  // Traffic
  renderTrafficChart(state);

  // Sex
  sexChart.data.datasets[0].data = [state.sexBreakdown.Male, state.sexBreakdown.Female];
  sexChart.update('none');
  renderSexBars(state.sexBreakdown);

  // Age
  ageChart.data.datasets[0].data = Object.values(state.ageBreakdown);
  ageChart.update('none');

  // Origin
  originChart.data.datasets[0].data = Object.values(state.originBreakdown);
  originChart.update('none');

  // Overlay + log
  buildOverlay(state.activePeople, state.detections || []);
  renderLog(state.detections || []);
});
