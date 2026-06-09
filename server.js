const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Detection Engine ───────────────────────────────────────────────
// Simulates frame-by-frame person detection from the video feed.
// Replace this section with your real CV model output (e.g. YOLOv8 / OpenCV).

const SEX_OPTIONS     = ['Male', 'Female'];
const AGE_GROUPS      = ['0–17', '18–25', '26–35', '36–50', '51–65', '65+'];
const ORIGIN_OPTIONS  = ['South Asian', 'East Asian', 'Middle Eastern', 'African', 'European', 'American', 'Other'];

// Rolling state
let detectionState = {
  totalToday: 0,
  activePeople: 0,
  hourlyData: Array(24).fill(0),   // count per hour
  dailyData:  Array(7).fill(0),    // count per weekday (Sun–Sat)
  sexBreakdown:    { Male: 0, Female: 0 },
  ageBreakdown:    Object.fromEntries(AGE_GROUPS.map(a => [a, 0])),
  originBreakdown: Object.fromEntries(ORIGIN_OPTIONS.map(o => [o, 0])),
  detections: [],  // last N detections
};

// Pre-seed with realistic-looking historical data
function seedHistory() {
  const now = new Date();
  const hour = now.getHours();

  // Hourly — traffic peaks at 9–11 and 17–19
  const hourCurve = [2,1,1,0,1,3,8,15,22,28,25,20,18,16,14,19,24,27,22,15,10,7,5,3];
  detectionState.hourlyData = hourCurve.map(v => v + Math.floor(Math.random() * 4));

  // Daily — weekday heavier
  detectionState.dailyData = [45, 110, 130, 125, 128, 95, 50];

  // Analytics totals from history
  detectionState.totalToday = detectionState.hourlyData.slice(0, hour + 1).reduce((a,b)=>a+b,0);

  const total = detectionState.totalToday || 1;
  detectionState.sexBreakdown = {
    Male: Math.round(total * 0.54),
    Female: Math.round(total * 0.46),
  };

  const ageWeights = [0.08, 0.18, 0.22, 0.24, 0.17, 0.11];
  AGE_GROUPS.forEach((g, i) => {
    detectionState.ageBreakdown[g] = Math.round(total * ageWeights[i]);
  });

  const originWeights = [0.28, 0.12, 0.18, 0.10, 0.15, 0.10, 0.07];
  ORIGIN_OPTIONS.forEach((o, i) => {
    detectionState.originBreakdown[o] = Math.round(total * originWeights[i]);
  });
}

seedHistory();

// Simulate live detections every 2–5 seconds
function simulateDetection() {
  const count = Math.floor(Math.random() * 3) + 1;  // 1–3 people per frame burst

  for (let i = 0; i < count; i++) {
    const sex    = SEX_OPTIONS[Math.random() < 0.54 ? 0 : 1];
    const age    = AGE_GROUPS[weightedRandom([0.08,0.18,0.22,0.24,0.17,0.11])];
    const origin = ORIGIN_OPTIONS[weightedRandom([0.28,0.12,0.18,0.10,0.15,0.10,0.07])];
    const conf   = (0.72 + Math.random() * 0.27).toFixed(2);
    const hour   = new Date().getHours();

    detectionState.totalToday++;
    detectionState.hourlyData[hour]++;
    detectionState.sexBreakdown[sex]++;
    detectionState.ageBreakdown[age]++;
    detectionState.originBreakdown[origin]++;

    const detection = { sex, age, origin, confidence: parseFloat(conf), ts: Date.now() };
    detectionState.detections.unshift(detection);
    if (detectionState.detections.length > 50) detectionState.detections.pop();
  }

  // Active count fluctuates
  detectionState.activePeople = Math.max(0,
    detectionState.activePeople + (Math.random() < 0.5 ? count : -Math.floor(Math.random() * 2))
  );
  detectionState.activePeople = Math.min(detectionState.activePeople, 30);

  io.emit('detection_update', detectionState);

  const next = 2000 + Math.random() * 3000;
  setTimeout(simulateDetection, next);
}

simulateDetection();

// ─── Socket.IO ───────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  // Send full state on connect
  socket.emit('detection_update', detectionState);

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ─── Utils ───────────────────────────────────────────────────────────
function weightedRandom(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  Surveillance Dashboard → http://localhost:${PORT}\n`);
});
