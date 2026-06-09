#!/usr/bin/env bash
# Process singapor/public/new.mp4 → entrance_processed.mp4 + entrance_data.json
set -e
cd "$(dirname "$0")"

if [[ ! -f public/new.mp4 ]]; then
  echo "❌ Put your video at: singapor/public/new.mp4"
  exit 1
fi

echo "▶ Processing new.mp4 (this may take 10–20+ minutes for long videos)..."
python3 process_video.py

echo ""
echo "✅ Done! Refresh the dashboard: http://localhost:3000 (Ctrl+Shift+R)"
