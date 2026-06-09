const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SINGAPOR_DIR = path.join(__dirname, 'singapor', 'public');
const PLAYLIST_FILE = path.join(SINGAPOR_DIR, 'playlist.json');
const PLAYLIST_INPUTS = ['at1', 'at2', 'at3'];

app.use(express.static(path.join(__dirname, 'public')));
if (fs.existsSync(SINGAPOR_DIR)) {
  app.use('/singapor', express.static(SINGAPOR_DIR));
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function buildPlaylistEntry(name, index) {
  const processed = `${name}_processed.mp4`;
  const telemetry = `${name}_data.json`;
  const videoPath = path.join(SINGAPOR_DIR, processed);
  const dataPath = path.join(SINGAPOR_DIR, telemetry);
  if (!fs.existsSync(videoPath) || !fs.existsSync(dataPath)) return null;
  const stats = readJsonSafe(dataPath) || [];
  return {
    id: name,
    label: `Camera ${index}`,
    video: `/singapor/${processed}`,
    telemetry: `/singapor/${telemetry}`,
    duration: stats[stats.length - 1]?.timestamp || 0,
    frames: stats.length,
    videoVersion: Math.floor(fileMtime(videoPath)),
  };
}

function discoverPlaylist() {
  const fromInputs = PLAYLIST_INPUTS.map((name, i) => buildPlaylistEntry(name, i + 1)).filter(Boolean);
  if (fromInputs.length > 0) return fromInputs;
  if (fs.existsSync(PLAYLIST_FILE)) {
    const saved = readJsonSafe(PLAYLIST_FILE);
    if (saved?.videos?.length) {
      return saved.videos.map((item) => {
        const dataPath = path.join(SINGAPOR_DIR, path.basename(item.telemetry || ''));
        const videoPath = path.join(SINGAPOR_DIR, path.basename(item.video || ''));
        const stats = readJsonSafe(dataPath) || [];
        return {
          ...item,
          duration: item.duration || stats[stats.length - 1]?.timestamp || 0,
          frames: stats.length,
          videoVersion: fileMtime(videoPath) || undefined,
        };
      });
    }
  }
  return [];
}

function needsReprocess() {
  return PLAYLIST_INPUTS.some((name) => {
    for (const ext of ['.avi', '.mp4']) {
      const inputPath = path.join(SINGAPOR_DIR, `${name}${ext}`);
      const outputPath = path.join(SINGAPOR_DIR, `${name}_processed.mp4`);
      if (fs.existsSync(inputPath) && !fs.existsSync(outputPath)) return true;
      if (fs.existsSync(inputPath) && fs.existsSync(outputPath)) {
        return fileMtime(inputPath) > fileMtime(outputPath);
      }
    }
    return false;
  });
}

app.get('/api/singapore/playlist', (req, res) => {
  const videos = discoverPlaylist();
  if (!videos.length) {
    return res.status(404).json({ error: 'No processed videos. Run: cd singapor && python3 process_video.py --force' });
  }
  res.json({ version: 1, loop: true, videos });
});

app.get('/api/singapore/status', (req, res) => {
  const videos = discoverPlaylist();
  const first = videos[0];
  let frames = 0;
  let duration = 0;
  videos.forEach((v) => { frames += v.frames || 0; duration += v.duration || 0; });
  res.json({
    available: videos.length > 0,
    mode: videos.length > 1 ? 'playlist' : 'single',
    videoCount: videos.length,
    video: first?.video || null,
    telemetry: first?.telemetry || null,
    videoVersion: first?.videoVersion || null,
    frames,
    duration,
    playlist: videos.length ? '/api/singapore/playlist' : null,
    needsReprocess: needsReprocess(),
  });
});

const USE_SINGAPOR = discoverPlaylist().length > 0;

const SEX_OPTIONS = ['Male', 'Female'];
const AGE_GROUPS = ['0–17', '18–25', '26–35', '36–50', '51–65', '65+'];
const ORIGIN_OPTIONS = ['South Asian', 'East Asian', 'Middle Eastern', 'African', 'European', 'American', 'Other'];

let detectionState = {
  totalToday: 0,
  activePeople: 0,
  hourlyData: Array(24).fill(0),
  dailyData: Array(7).fill(0),
  sexBreakdown: { Male: 0, Female: 0 },
  ageBreakdown: Object.fromEntries(AGE_GROUPS.map(a => [a, 0])),
  originBreakdown: Object.fromEntries(ORIGIN_OPTIONS.map(o => [o, 0])),
  detections: [],
};

function simulateDetection() {
  const count = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < count; i++) {
    const sex = SEX_OPTIONS[Math.random() < 0.54 ? 0 : 1];
    const age = AGE_GROUPS[Math.floor(Math.random() * AGE_GROUPS.length)];
    const origin = ORIGIN_OPTIONS[Math.floor(Math.random() * ORIGIN_OPTIONS.length)];
    detectionState.totalToday++;
    detectionState.hourlyData[new Date().getHours()]++;
    detectionState.sexBreakdown[sex]++;
    detectionState.ageBreakdown[age]++;
    detectionState.originBreakdown[origin]++;
    detectionState.detections.unshift({ sex, age, origin, confidence: 0.9, ts: Date.now() });
    if (detectionState.detections.length > 50) detectionState.detections.pop();
  }
  detectionState.activePeople = Math.min(30, Math.max(0, detectionState.activePeople + count - 1));
  io.emit('detection_update', detectionState);
  setTimeout(simulateDetection, 2000 + Math.random() * 3000);
}

if (!USE_SINGAPOR) {
  simulateDetection();
} else {
  const pl = discoverPlaylist();
  console.log(`  Singapore playlist: ${pl.length} videos`);
  pl.forEach((v, i) => console.log(`    ${i + 1}. ${v.label} — ${v.video}`));
}

io.on('connection', (socket) => {
  if (!USE_SINGAPOR) socket.emit('detection_update', detectionState);
  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  Surveillance Dashboard → http://localhost:${PORT}`);
  console.log(USE_SINGAPOR ? '  Mode: Singapore live video + detection\n' : '  Mode: Simulated detections\n');
});
