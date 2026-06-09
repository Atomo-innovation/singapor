# VisionTrack — Surveillance Dashboard

A real-time people-detection dashboard built with Node.js, Express, Socket.IO, and Chart.js.

## Quick Start

```bash
npm install
node server.js
# Open http://localhost:3000
```

## Add Your Video

Drop your video file into `public/videos/` and name it:
- `feed.mp4`  (recommended — H.264)
- `feed.webm` (VP9/AV1 alternative)

The video plays automatically, muted and looped, on page load.

## Project Structure

```
surveillance-dashboard/
├── server.js              # Express + Socket.IO server + detection engine
├── public/
│   ├── index.html         # Dashboard UI
│   ├── css/
│   │   └── dashboard.css  # Dark surveillance theme
│   ├── js/
│   │   └── dashboard.js   # Chart.js + Socket.IO client + canvas overlay
│   └── videos/
│       └── feed.mp4       # ← Place your video here
└── README.md
```

## Connecting a Real CV Model

In `server.js`, find the `simulateDetection()` function and replace its body
with your actual detection pipeline output. Each detection event should emit:

```js
io.emit('detection_update', {
  totalToday:      <number>,
  activePeople:    <number>,
  hourlyData:      <number[24]>,   // counts per hour 0–23
  dailyData:       <number[7]>,    // counts per weekday Sun–Sat
  sexBreakdown:    { Male: N, Female: N },
  ageBreakdown:    { '0–17': N, '18–25': N, '26–35': N, '36–50': N, '51–65': N, '65+': N },
  originBreakdown: { 'South Asian': N, 'East Asian': N, ... },
  detections:      [{ sex, age, origin, confidence, ts }, ...]
});
```

Compatible with any backend detector (YOLOv8 + DeepFace, OpenCV, etc.) —
pipe results into `io.emit()` and the dashboard updates live.

## Tech Stack

| Layer       | Tech                        |
|-------------|----------------------------|
| Server      | Node.js + Express           |
| Real-time   | Socket.IO (WebSockets)      |
| Charts      | Chart.js 4                  |
| Video       | HTML5 `<video>` (mp4/webm)  |
| Fonts       | Inter + JetBrains Mono      |
# singapor
# person_detection
# person_detection
