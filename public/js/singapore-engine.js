/* ══════════════════════════════════════════════════════════════════════
   ATOMO — Singapore multi-video playlist engine
   Plays at1 → at2 → at3 in sequence; analytics persist and grow across loops.
══════════════════════════════════════════════════════════════════════ */
'use strict';

const AGE_GROUPS     = ['0–17', '18–25', '26–35', '36–50', '51–65', '65+'];
const ORIGIN_OPTIONS = ['South Asian', 'East Asian', 'Middle Eastern', 'African', 'European', 'American', 'Other'];

let playlist = [];
let currentVideoIndex = 0;
let videoStats = [];
let videoDuration = 10;
let lastFrameIdx = -1;
let lastIngestedFrame = 0;
let globalTimeOffset = 0;
let playlistTotalDuration = 0;
let playlistLoopCount = 0;
let advancing = false;
let cacheVersion = '';

// Session analytics — never reset on playlist loop
const sessionPeople = new Map();
const faceFirstAppearances = new Map();
const sessionLoggedIds = new Set();
let detectionLog = [];

function makeGlobalId(videoIndex, detId) {
  return `L${playlistLoopCount}:v${videoIndex}:${detId}`;
}

function getFrameIndex(currentTime) {
  if (!videoStats.length) return 1;
  let lo = 0;
  let hi = videoStats.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (videoStats[mid].timestamp <= currentTime) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function mapAge(age) {
  const table = {
    '0-2': '0–17', '3-9': '0–17', '10-19': '0–17',
    '20-29': '18–25', '30-39': '26–35',
    '40-49': '36–50', '50-59': '51–65',
    '60-69': '65+', '70+': '65+',
  };
  return table[age] || null;
}

function mapOrigin(id, race) {
  if (!race || race === 'Unknown') return 'Other';
  const map = {
    Black: 'African',
    White: 'European',
    'Latino/Hispanic': 'American',
    'Middle Eastern': 'Middle Eastern',
  };
  if (race === 'Asian') {
    const bucket = id % 3;
    if (bucket === 0) return 'East Asian';
    if (bucket === 1) return 'South Asian';
    return 'East Asian';
  }
  return map[race] || 'Other';
}

function confidenceFor(det) {
  let score = 0.55;
  if (det.gender !== 'Unknown') score += 0.14;
  if (det.age !== 'Unknown') score += 0.14;
  if (det.race !== 'Unknown') score += 0.14;
  return Math.min(0.98, score);
}

function mapDetection(det, videoIndex) {
  const sex = det.gender === 'Male' || det.gender === 'Female' ? det.gender : 'Male';
  const age = mapAge(det.age) || '26–35';
  const origin = mapOrigin(det.id, det.race);
  return {
    id: det.id,
    globalId: makeGlobalId(videoIndex, det.id),
    sex,
    age,
    origin,
    confidence: confidenceFor(det),
    ts: Date.now(),
    emotion: det.emotion || 'Unknown',
  };
}

function emptyBreakdowns() {
  return {
    sexBreakdown: { Male: 0, Female: 0 },
    ageBreakdown: Object.fromEntries(AGE_GROUPS.map(a => [a, 0])),
    originBreakdown: Object.fromEntries(ORIGIN_OPTIONS.map(o => [o, 0])),
  };
}

function buildBreakdownsFromSession() {
  const breakdowns = emptyBreakdowns();
  sessionPeople.forEach(person => {
    if (person.sex === 'Male') breakdowns.sexBreakdown.Male++;
    else if (person.sex === 'Female') breakdowns.sexBreakdown.Female++;
    if (person.age) breakdowns.ageBreakdown[person.age]++;
    if (person.origin) breakdowns.originBreakdown[person.origin]++;
  });
  return breakdowns;
}

function getSessionTimelineDuration() {
  const elapsed = globalTimeOffset + videoDuration;
  const loopSpan = (playlistTotalDuration || 1) * Math.max(1, playlistLoopCount + 1);
  return Math.max(loopSpan, elapsed, 1);
}

function buildHourlyDaily(globalVideoTime) {
  const hourlyData = Array(24).fill(0);
  const timeline = getSessionTimelineDuration();
  const currentHour = Math.min(23, Math.floor((globalVideoTime / timeline) * 24));

  sessionPeople.forEach((_, gId) => {
    const enterTime = faceFirstAppearances.get(gId) || 0;
    const h = Math.min(23, Math.floor((enterTime / timeline) * 24));
    if (h <= currentHour) hourlyData[h]++;
  });

  for (let h = currentHour + 1; h < 24; h++) {
    hourlyData[h] = null;
  }

  const total = sessionPeople.size;
  const dailyData = [
    Math.round(total * 0.4),
    Math.round(total * 0.5),
    Math.round(total * 0.7),
    Math.round(total * 0.8),
    total,
    Math.round(total * 1.1),
    Math.round(total * 0.9),
  ];

  return { hourlyData, dailyData };
}

function ingestFramesUpTo(currentFrame) {
  for (let f = lastIngestedFrame; f < currentFrame; f++) {
    const frame = videoStats[f];
    if (!frame) continue;

    frame.detections?.forEach(det => {
      const gId = makeGlobalId(currentVideoIndex, det.id);
      const globalTs = globalTimeOffset + (frame.timestamp || 0);

      if (!faceFirstAppearances.has(gId)) {
        faceFirstAppearances.set(gId, globalTs);
      }

      if (!sessionPeople.has(gId)) {
        const mapped = mapDetection(det, currentVideoIndex);
        sessionPeople.set(gId, mapped);

        if (!sessionLoggedIds.has(gId)) {
          sessionLoggedIds.add(gId);
          mapped.ts = Date.now();
          detectionLog.unshift({ ...mapped });
          if (detectionLog.length > 50) detectionLog.pop();
        }
      }
    });
  }
  lastIngestedFrame = currentFrame;
}

function buildDashboardState(frameData, videoTime) {
  const breakdowns = buildBreakdownsFromSession();
  const globalVideoTime = globalTimeOffset + videoTime;
  const { hourlyData, dailyData } = buildHourlyDaily(globalVideoTime);

  const currentDetections = (frameData.detections || [])
    .map(det => mapDetection(det, currentVideoIndex))
    .filter(d => d.confidence > 0.6);

  return {
    activePeople: frameData.active_faces || currentDetections.length,
    totalToday: sessionPeople.size,
    hourlyData,
    dailyData,
    ...breakdowns,
    detections: detectionLog.length ? detectionLog : currentDetections,
    source: 'singapore',
    videoTime: globalVideoTime,
    playlistIndex: currentVideoIndex,
    playlistLabel: playlist[currentVideoIndex]?.label || '',
    playlistLoop: playlistLoopCount,
  };
}

function updateHudLabel() {
  const item = playlist[currentVideoIndex];
  const camLoc = document.querySelector('.vhd-loc');
  if (camLoc && item) {
    const loopTag = playlistLoopCount > 0 ? ` · LOOP ${playlistLoopCount + 1}` : '';
    camLoc.textContent = `${item.label?.toUpperCase() || item.id?.toUpperCase()} — LIVE${loopTag}`;
  }
  const sysLabel = document.querySelector('.topbar-center .sys-stat:nth-child(2) .sys-label');
  if (sysLabel && item) {
    sysLabel.textContent = `CAM 0${currentVideoIndex + 1} — ${item.label || item.id}`;
  }
}

function videoUrl(item) {
  const base = item.video;
  const bust = item.videoVersion || cacheVersion || item.id;
  return `${base}?v=${bust}`;
}

async function loadTelemetry(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('Empty telemetry');
  videoStats = data;
  videoDuration = data[data.length - 1]?.timestamp || 10;
  lastFrameIdx = -1;
  lastIngestedFrame = 0;
}

function waitForVideoReady(video, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error('Video load timeout'));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const fail = () => {
      clearTimeout(timer);
      reject(new Error('Video load error'));
    };
    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('error', fail, { once: true });
  });
}

async function safePlay(video) {
  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  try {
    await video.play();
  } catch {
    await new Promise(r => setTimeout(r, 250));
    await video.play().catch(err => console.warn('[Singapore] play failed:', err));
  }
}

async function loadVideoAtIndex(video, index) {
  const item = playlist[index];
  if (!item) return false;

  currentVideoIndex = index;
  await loadTelemetry(item.telemetry);

  video.pause();
  video.removeAttribute('loop');
  video.loop = false;
  video.src = videoUrl(item);
  video.load();

  await waitForVideoReady(video);
  if (video.duration && Number.isFinite(video.duration)) {
    videoDuration = video.duration;
  }
  video.currentTime = 0;
  updateHudLabel();
  return true;
}

async function advanceToNextVideo(video) {
  if (advancing || !playlist.length) return;
  advancing = true;

  try {
    globalTimeOffset += videoDuration || 0;
    const nextIndex = (currentVideoIndex + 1) % playlist.length;

    if (nextIndex === 0) {
      playlistLoopCount++;
      console.log(`[Singapore] Playlist loop #${playlistLoopCount + 1} — analytics continue`);
    }

    await loadVideoAtIndex(video, nextIndex);
    await safePlay(video);
    syncFrame(video);
  } catch (err) {
    console.error('[Singapore] Failed to advance video:', err);
    setTimeout(() => {
      advancing = false;
      advanceToNextVideo(video);
    }, 1000);
    return;
  }

  advancing = false;
}

function syncFrame(video) {
  if (!videoStats.length || !video || advancing) return;

  const currentFrame = getFrameIndex(video.currentTime);
  if (currentFrame === lastFrameIdx) return;
  lastFrameIdx = currentFrame;

  ingestFramesUpTo(currentFrame);

  const frameData = videoStats[currentFrame - 1];
  if (!frameData) return;

  const state = buildDashboardState(frameData, video.currentTime);
  window.applyDetectionState?.(state);
}

function checkNearEnd(video) {
  if (advancing || !video.duration || video.paused) return;
  if (video.currentTime >= video.duration - 0.2) {
    advanceToNextVideo(video);
  }
}

function bindVideoEvents(video) {
  video.addEventListener('timeupdate', () => {
    syncFrame(video);
    checkNearEnd(video);
  });
  video.addEventListener('seeked', () => {
    lastFrameIdx = -1;
    lastIngestedFrame = 0;
    syncFrame(video);
  });
  video.addEventListener('ended', () => {
    advanceToNextVideo(video);
  });
  video.addEventListener('error', () => {
    console.error('[Singapore] Video error, skipping to next');
    advanceToNextVideo(video);
  });
}

async function fetchPlaylist() {
  const res = await fetch('/api/singapore/playlist', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Playlist HTTP ${res.status}`);
  const data = await res.json();
  if (!data.videos?.length) throw new Error('Empty playlist');
  return data;
}

function showReprocessBanner(message) {
  const banner = document.getElementById('layout-edit-banner');
  if (!banner) return;
  banner.querySelector('span').textContent = message;
  banner.classList.add('visible');
}

async function initSingaporeEngine() {
  const video = document.getElementById('feed-video');
  const placeholder = document.getElementById('video-placeholder');
  if (!video) return false;

  let needsReprocess = false;

  try {
    const statusRes = await fetch('/api/singapore/status', { cache: 'no-store' });
    if (statusRes.ok) {
      const status = await statusRes.json();
      if (!status.available) throw new Error('Singapore assets missing');
      cacheVersion = status.videoVersion || Date.now();
      needsReprocess = status.needsReprocess;
    }
  } catch (err) {
    console.warn('[Singapore] Status check failed:', err);
  }

  try {
    const data = await fetchPlaylist();
    playlist = data.videos;
    playlistTotalDuration = playlist.reduce((sum, v) => sum + (v.duration || 0), 0);
  } catch (err) {
    console.warn('[Singapore] Playlist unavailable, using simulated feed.', err);
    return false;
  }

  if (needsReprocess) {
    showReprocessBanner(
      'New videos detected — run: cd singapor && python3 process_video.py — then hard-refresh.'
    );
  }

  video.removeAttribute('loop');
  video.loop = false;

  const ok = await loadVideoAtIndex(video, 0);
  if (!ok) return false;

  bindVideoEvents(video);

  video.addEventListener('canplay', async () => {
    if (placeholder) placeholder.style.display = 'none';
    await safePlay(video);
    syncFrame(video);
  }, { once: true });

  document.body.classList.add('singapore-mode');
  window.SINGAPORE_MODE = true;

  const totalFrames = playlist.reduce((sum, v) => sum + (v.frames || 0), 0);
  console.log(
    `[Singapore] Playlist ready — ${playlist.length} videos, ` +
    `${playlistTotalDuration.toFixed(1)}s total, ${totalFrames || '?'} frames`
  );
  return true;
}

window.initSingaporeEngine = initSingaporeEngine;
