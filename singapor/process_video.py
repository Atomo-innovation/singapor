#!/usr/bin/env python3
"""
InspireFace Mall Video Pre-Processor
Processes 'public/entrance.mp4' frame-by-frame using InspireFace,
extracts dense landmarks, attributes, tracks IDs, detects line crossings,
writes annotated frames to a new video, and outputs a synced JSON telemetry file.
"""

import argparse
import cv2
import numpy as np
import os
import sys
import json
import math
import subprocess
import inspireface as isf

# ==========================================
# CONFIGURATION & CONSTANTS
# ==========================================

PUBLIC_DIR = "public"
INPUT_VIDEOS = [
    "public/at1.avi",
    "public/at2.avi",
    "public/at3.avi",
]
PLAYLIST_OUTPUT = "public/playlist.json"

race_tags = ["Black", "Asian", "Latino/Hispanic", "Middle Eastern", "White"]
gender_tags = ["Female", "Male"]
age_bracket_tags = [
    "0-2 years old", "3-9 years old", "10-19 years old", "20-29 years old", "30-39 years old",
    "40-49 years old", "50-59 years old", "60-69 years old", "more than 70 years old"
]
emotion_tags = ["Neutral", "Happy", "Sad", "Surprise", "Fear", "Disgust", "Anger"]

# ==========================================
# CENTROID TRACKER
# ==========================================

class CentroidTracker:
    def __init__(self, maxDisappeared=20, maxDistance=90):
        self.nextObjectID = 101
        self.objects = {}       # ID -> centroid (x, y)
        self.bboxes = {}        # ID -> bbox (x1, y1, x2, y2)
        self.disappeared = {}   # ID -> count
        self.history = {}       # ID -> list of past centroids
        self.attributes = {}    # ID -> dict of stable attributes
        self.maxDisappeared = maxDisappeared
        self.maxDistance = maxDistance

    def register(self, centroid, bbox, attrs):
        self.objects[self.nextObjectID] = centroid
        self.bboxes[self.nextObjectID] = bbox
        self.disappeared[self.nextObjectID] = 0
        self.history[self.nextObjectID] = [centroid]
        self.attributes[self.nextObjectID] = attrs
        self.nextObjectID += 1

    def deregister(self, objectID):
        del self.objects[objectID]
        del self.bboxes[objectID]
        del self.disappeared[objectID]
        del self.history[objectID]
        # Keep attributes in case they come back or for stats summary

    def update(self, rects, attr_list):
        # rects: list of (x1, y1, x2, y2)
        # attr_list: list of attribute dicts matching rects
        if len(rects) == 0:
            for objectID in list(self.disappeared.keys()):
                self.disappeared[objectID] += 1
                if self.disappeared[objectID] > self.maxDisappeared:
                    self.deregister(objectID)
            return self.objects

        inputCentroids = np.zeros((len(rects), 2), dtype="int")
        for (i, (x1, y1, x2, y2)) in enumerate(rects):
            cX = int((x1 + x2) / 2.0)
            cY = int((y1 + y2) / 2.0)
            inputCentroids[i] = (cX, cY)

        if len(self.objects) == 0:
            for i in range(0, len(inputCentroids)):
                self.register(inputCentroids[i], rects[i], attr_list[i])
        else:
            objectIDs = list(self.objects.keys())
            objectCentroids = list(self.objects.values())

            # Distance matrix
            D = np.zeros((len(objectCentroids), len(inputCentroids)))
            for i in range(len(objectCentroids)):
                for j in range(len(inputCentroids)):
                    D[i, j] = math.sqrt((objectCentroids[i][0] - inputCentroids[j][0])**2 + 
                                         (objectCentroids[i][1] - inputCentroids[j][1])**2)

            rows = D.min(axis=1).argsort()
            cols = D.argmin(axis=1)[rows]

            usedRows = set()
            usedCols = set()

            for (row, col) in zip(rows, cols):
                if row in usedRows or col in usedCols:
                    continue

                if D[row, col] > self.maxDistance:
                    continue

                objectID = objectIDs[row]
                self.objects[objectID] = inputCentroids[col]
                self.bboxes[objectID] = rects[col]
                self.disappeared[objectID] = 0
                self.history[objectID].append(inputCentroids[col])
                if len(self.history[objectID]) > 10:
                    self.history[objectID].pop(0)
                
                # Update attributes with latest detection
                self.attributes[objectID] = attr_list[col]

                usedRows.add(row)
                usedCols.add(col)

            unusedRows = set(range(0, D.shape[0])).difference(usedRows)
            unusedCols = set(range(0, D.shape[1])).difference(usedCols)

            for row in unusedRows:
                objectID = objectIDs[row]
                self.disappeared[objectID] += 1
                if self.disappeared[objectID] > self.maxDisappeared:
                    self.deregister(objectID)

            for col in unusedCols:
                self.register(inputCentroids[col], rects[col], attr_list[col])

        return self.objects

# ==========================================
# PROCESSING PIPELINE
# ==========================================

def video_paths(input_video):
    base = os.path.splitext(os.path.basename(input_video))[0]
    return {
        "id": base,
        "temp": os.path.join(PUBLIC_DIR, f"temp_{base}_processed.mp4"),
        "output_video": os.path.join(PUBLIC_DIR, f"{base}_processed.mp4"),
        "output_json": os.path.join(PUBLIC_DIR, f"{base}_data.json"),
    }


def needs_reprocess(input_video, output_video, output_json):
    if not os.path.exists(input_video):
        return False
    if not os.path.exists(output_video) or not os.path.exists(output_json):
        return True
    input_mtime = os.path.getmtime(input_video)
    return (
        input_mtime > os.path.getmtime(output_video)
        or input_mtime > os.path.getmtime(output_json)
    )


def normalize_fps(raw_fps):
    fps = float(raw_fps or 30.0)
    if fps <= 0 or fps > 120 or math.isnan(fps):
        fps = 30.0
    return round(fps, 3)


def transcode_video(temp_video, output_video, fps):
    print(f"🎥 Transcoding to H.264 @ {fps:.3f} fps...")
    gop = max(12, int(round(fps * 2)))
    ffmpeg_cmd = [
        "ffmpeg", "-y", "-i", temp_video, "-an",
        "-vcodec", "libx264", "-preset", "medium", "-profile:v", "main",
        "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(fps),
        "-vsync", "cfr", "-g", str(gop), "-keyint_min", str(gop),
        "-sc_threshold", "0", "-movflags", "+faststart", output_video,
    ]
    try:
        subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"🎉 Saved: {output_video}")
        if os.path.exists(temp_video):
            os.remove(temp_video)
    except Exception as e:
        print(f"❌ Transcode failed: {e}")
        if os.path.exists(temp_video):
            os.rename(temp_video, output_video)


def init_inspireface():
    candidates = [
        os.path.expanduser("~/.inspireface/ms/tunmxy/InspireFace/Pikachu"),
        os.path.expanduser("~/.inspireface/models/Pikachu"),
    ]
    resource_path = next((p for p in candidates if os.path.exists(p)), None)
    isf.ignore_check_latest_model(True)
    if isf.query_launch_status():
        return
    if resource_path:
        print(f"Using cached model: {resource_path}")
        if not isf.launch(resource_path=resource_path):
            raise RuntimeError("InspireFace launch failed")
        return
    isf.use_oss_download(True)
    if not isf.launch():
        raise RuntimeError("InspireFace launch failed")


def process_single_video(session, hog, input_video, temp_video, output_video, output_json):
    print(f"\n{'=' * 60}\n🎬 Processing: {input_video}\n{'=' * 60}")
    if not os.path.exists(input_video):
        raise FileNotFoundError(input_video)

    cap = cv2.VideoCapture(input_video)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = normalize_fps(cap.get(cv2.CAP_PROP_FPS))
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # Target scale
    target_w = 960
    target_h = int(orig_h * (target_w / orig_w))
    
    print(f"Video Dimensions : {orig_w}x{orig_h} -> Resizing to {target_w}x{target_h}")
    print(f"Frame Count      : {total_frames} frames @ {fps:.2f} fps")

    # Set up OpenCV video writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(temp_video, fourcc, fps, (target_w, target_h))
    if not out.isOpened():
        cap.release()
        raise RuntimeError(f"Cannot open writer: {temp_video}")

    # Initialize tracker
    tracker = CentroidTracker(maxDisappeared=15, maxDistance=120)
    line_y = int(orig_h * 0.60) # Virtual gate crossing boundary (calculated in original coordinates)
    
    # Stats tracking variables
    unique_crossed_ids = set()
    frame_stats = []
    
    # Frame counters for drawing line cross flashes
    line_flash_enter = 0
    line_flash_exit = 0

    frame_idx = 0
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame_idx += 1
        print(f"⏳ Processing Frame {frame_idx}/{total_frames} ({(frame_idx/total_frames)*100:.1f}%)", end="\r")

        # Create canvas for drawing overlays in original resolution
        draw = frame.copy()
        
        # Scaling parameters for drawing overlays
        scale = max(orig_w, orig_h) / 1000.0
        line_thickness = max(1, int(2 * scale))
        circle_radius = max(1, int(1.5 * scale))
        font_scale = 0.42 * scale

        # Run face detection on the high-res original frame
        faces = session.face_detection(frame)
        extends = []
        
        if len(faces) > 0:
            select_exec_func = (
                isf.HF_ENABLE_QUALITY |
                isf.HF_ENABLE_MASK_DETECT |
                isf.HF_ENABLE_LIVENESS |
                isf.HF_ENABLE_INTERACTION |
                isf.HF_ENABLE_FACE_ATTRIBUTE |
                isf.HF_ENABLE_FACE_EMOTION
            )
            extends = session.face_pipeline(frame, faces, select_exec_func)

        # Grayscale and downscale to 640x360 for fast HOG human detection execution
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray_small = cv2.resize(gray, (640, 360))
        
        scale_x = orig_w / 640.0
        scale_y = orig_h / 360.0

        # Detect bodies using HOG (winStride and padding tuned for speed/accuracy)
        (bodies, weights) = hog.detectMultiScale(gray_small, winStride=(4, 4), padding=(8, 8), scale=1.05)

        fallback_candidates = []

        # Map full-body detections to head boxes (top 12% of body height, centered horizontally, shifted down by 9% for top HOG padding)
        for (x, y, w, h) in bodies:
            ox1 = int((x + w * 0.28) * scale_x)
            oy1 = int((y + h * 0.09) * scale_y)
            ox2 = int((x + w * 0.72) * scale_x)
            oy2 = int((y + h * 0.21) * scale_y)
            fallback_candidates.append((ox1, oy1, ox2, oy2))

        # Overlap helper: Intersection over candidate box Area (IoA)
        def get_overlap_ratio(boxA, boxB):
            x_left = max(boxA[0], boxB[0])
            y_top = max(boxA[1], boxB[1])
            x_right = min(boxA[2], boxB[2])
            y_bottom = min(boxA[3], boxB[3])

            if x_right < x_left or y_bottom < y_top:
                return 0.0

            intersection_area = (x_right - x_left) * (y_bottom - y_top)
            areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
            return intersection_area / areaA if areaA > 0 else 0.0

        # Collect non-overlapping fallback head detections
        head_only_boxes = []
        for cand in fallback_candidates:
            is_overlap = False
            for face in faces:
                fx1, fy1, fx2, fy2 = face.location
                if get_overlap_ratio(cand, (fx1, fy1, fx2, fy2)) > 0.35:
                    is_overlap = True
                    break
            if not is_overlap:
                for existing in head_only_boxes:
                    if get_overlap_ratio(cand, existing) > 0.45:
                        is_overlap = True
                        break
            if not is_overlap:
                head_only_boxes.append(cand)

        # Collect detections for tracker
        rects = []
        attr_list = []
        
        for face, ext in zip(faces, extends):
            x1, y1, x2, y2 = face.location
            rects.append((x1, y1, x2, y2))
            
            # Extract demographic attributes
            gender = gender_tags[ext.gender]
            race = race_tags[ext.race]
            age = age_bracket_tags[ext.age_bracket].split(" ")[0] # e.g. "20-29"
            emotion = emotion_tags[ext.emotion]
            
            attr_list.append({
                "gender": gender,
                "race": race,
                "age": age,
                "emotion": emotion,
                "face_obj": face,
                "is_head_only": False
            })

        # Append fallback head-only detections
        for (hx1, hy1, hx2, hy2) in head_only_boxes:
            rects.append((hx1, hy1, hx2, hy2))
            attr_list.append({
                "gender": "Unknown",
                "race": "Unknown",
                "age": "Unknown",
                "emotion": "Unknown",
                "face_obj": None,
                "is_head_only": True
            })

        # Update centroid tracker
        objects = tracker.update(rects, attr_list)
        active_in_frame = sum(1 for obj_id in objects if tracker.disappeared[obj_id] == 0)

        # Loop active tracked objects to draw bounding boxes and check line crossings
        for obj_id, centroid in objects.items():
            # Only draw bounding box and overlays if the face is actually detected in the current frame
            if tracker.disappeared[obj_id] > 0:
                continue

            x1, y1, x2, y2 = tracker.bboxes[obj_id]
            attrs = tracker.attributes[obj_id]
            history = tracker.history[obj_id]

            is_head = attrs.get("is_head_only", False)

            if is_head:
                # Bounding box for Head-Only detection: thin, light gray
                box_color = (180, 180, 180) # BGR Light Gray
                cv2.rectangle(draw, (x1, y1), (x2, y2), box_color, 1, lineType=cv2.LINE_AA)
                
                info = [
                    f"ID:{obj_id}",
                    "Head Only"
                ]
                stack_h = len(info) * 14
                cv2.rectangle(draw, (x1, y1 - stack_h - 10), (x1 + 80, y1 - 5), (15, 15, 15), -1)
                cv2.rectangle(draw, (x1, y1 - stack_h - 10), (x1 + 80, y1 - 5), box_color, 1)

                y0 = y1 - 10
                for i, txt in enumerate(info):
                    cv2.putText(draw, txt, (x1 + 5, y0 - i * 13),
                                cv2.FONT_HERSHEY_SIMPLEX, font_scale,
                                (255, 255, 255), 1, cv2.LINE_AA)
            else:
                # Regular Face Detection drawing
                # Color outline according to tracked gender for high-end styling
                box_color = (29, 180, 100) # Green as in detection.py
                if attrs["gender"] == "Female":
                    box_color = (94, 63, 244) # BGR Coral
                else:
                    box_color = (212, 182, 6) # BGR Cyan

                # Retrieve the face object directly from attributes
                face_match = attrs.get("face_obj")
                
                if face_match:
                    # Get roll angle and size for rotated rectangle contour
                    center = ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
                    size = (x2 - x1, y2 - y1)
                    angle = face_match.roll
                    rect = (center, size, angle)
                    box = cv2.boxPoints(rect).astype(int)
                    cv2.drawContours(draw, [box], 0, box_color, line_thickness)

                    # 2. Draw Dense Landmarks points exactly as in detection.py
                    lmk = session.get_face_dense_landmark(face_match)
                    for lx, ly in lmk.astype(int):
                        cv2.circle(draw, (lx, ly), circle_radius, (220, 100, 0), -1) # Blue landmarks
                else:
                    # Fallback standard bounding box
                    cv2.rectangle(draw, (x1, y1), (x2, y2), box_color, line_thickness)

                # 3. Draw Attribute Text Stack above bounding box
                info = [
                    f"ID:{obj_id}",
                    f"{attrs['gender']}",
                    f"{attrs['age']} yrs",
                    f"{attrs['race']}",
                    f"{attrs['emotion']}"
                ]
                
                # Draw semi-transparent background box for legibility
                stack_h = len(info) * 14
                cv2.rectangle(draw, (x1, y1 - stack_h - 10), (x1 + 80, y1 - 5), (15, 15, 15), -1)
                cv2.rectangle(draw, (x1, y1 - stack_h - 10), (x1 + 80, y1 - 5), box_color, 1)

                y0 = y1 - 10
                for i, txt in enumerate(info):
                    cv2.putText(draw, txt, (x1 + 5, y0 - i * 13),
                                cv2.FONT_HERSHEY_SIMPLEX, font_scale,
                                (255, 255, 255), 1, cv2.LINE_AA)

            # 4. Check Line Crossing Trajectories
            if len(history) >= 2 and obj_id not in unique_crossed_ids:
                prev_y = history[-2][1]
                curr_y = centroid[1]

                # Crossed going down (Entering)
                if prev_y < line_y and curr_y >= line_y:
                    unique_crossed_ids.add(obj_id)
                    line_flash_enter = 6 # frames to flash green

                # Crossed going up (Exiting)
                elif prev_y > line_y and curr_y <= line_y:
                    unique_crossed_ids.add(obj_id)
                    line_flash_exit = 6 # frames to flash red

        # --------------------------------------
        # DRAW RUNTIME OVERLAYS
        # --------------------------------------
        
        # Draw horizontal scanning gate line
        gate_color = (99, 102, 241) # BGR Indigo
        gate_thickness = 1
        
        if line_flash_enter > 0:
            gate_color = (16, 185, 129) # BGR Emerald green
            gate_thickness = 3
            line_flash_enter -= 1
        elif line_flash_exit > 0:
            gate_color = (244, 63, 94) # BGR Coral red
            gate_thickness = 3
            line_flash_exit -= 1

        cv2.line(draw, (0, line_y), (orig_w, line_y), gate_color, gate_thickness)
        
        # Label overlays
        cv2.putText(draw, "FACIAL ANALYSIS COUNTER LIMIT", (15, line_y - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, gate_color, 1, cv2.LINE_AA)

        # Translucent HUD bar at the top
        overlay = draw.copy()
        cv2.rectangle(overlay, (0, 0), (orig_w, 35), (7, 9, 19), -1)
        cv2.addWeighted(overlay, 0.7, draw, 0.3, 0, draw)
        
        # Live HUD Text
        cv2.circle(draw, (18, 17), 4, (244, 63, 94), -1)
        cv2.putText(draw, "INSPIRE-FACE CORE: Real-Time Pedestrian Analysis", (28, 21),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (248, 250, 252), 1, cv2.LINE_AA)
        
        totals_str = f"ACTIVE: {active_in_frame}   |   UNIQUES DETECTED: {len(unique_crossed_ids)}"
        cv2.putText(draw, totals_str, (orig_w - 320, 21),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (6, 182, 212), 1, cv2.LINE_AA)

        # Resize the drawn high-resolution frame to target dimensions
        resized_draw = cv2.resize(draw, (target_w, target_h))
        # Save annotated frame
        out.write(resized_draw)

        # --------------------------------------
        # COLLECT TELEMETRY FOR JSON EXPORT
        # --------------------------------------
        active_demo_data = []
        for obj_id, centroid in objects.items():
            attrs = tracker.attributes[obj_id]
            active_demo_data.append({
                "id": obj_id,
                "gender": attrs["gender"],
                "age": attrs["age"],
                "race": attrs["race"],
                "emotion": attrs["emotion"]
            })

        frame_stats.append({
            "frame": frame_idx,
            "timestamp": round(frame_idx / fps, 2),
            "active_faces": active_in_frame,
            "unique_count": len(unique_crossed_ids),
            "detections": active_demo_data
        })

    # Cleanup openCV objects
    cap.release()
    out.release()
    print("\n✅ Done processing frames. Compiling outputs...")

    # 3. Save JSON telemetry file
    with open(output_json, "w") as f:
        json.dump(frame_stats, f, indent=2)
    print(f"📊 Telemetry saved: {output_json}")

    transcode_video(temp_video, output_video, fps)
    duration = frame_stats[-1]["timestamp"] if frame_stats else 0
    return {"frames": len(frame_stats), "duration": duration, "fps": fps}


def write_playlist(entries):
    with open(PLAYLIST_OUTPUT, "w") as f:
        json.dump({"version": 1, "loop": True, "videos": entries}, f, indent=2)
    print(f"\n📋 Playlist: {PLAYLIST_OUTPUT} ({len(entries)} videos)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Reprocess all videos")
    args = parser.parse_args()

    print("🎬 Initializing InspireFace Video Processing...")
    init_inspireface()
    isf.switch_image_processing_backend(isf.HF_IMAGE_PROCESSING_CPU)
    opt = (
        isf.HF_ENABLE_FACE_RECOGNITION | isf.HF_ENABLE_QUALITY |
        isf.HF_ENABLE_MASK_DETECT | isf.HF_ENABLE_LIVENESS |
        isf.HF_ENABLE_INTERACTION | isf.HF_ENABLE_FACE_ATTRIBUTE |
        isf.HF_ENABLE_FACE_EMOTION
    )
    session = isf.InspireFaceSession(opt, isf.HF_DETECT_MODE_ALWAYS_DETECT)
    session.set_detection_confidence_threshold(0.35)
    session.set_filter_minimum_face_pixel_size(24)
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    available = [v for v in INPUT_VIDEOS if os.path.exists(v)]
    if not available:
        print("❌ No input videos found:", INPUT_VIDEOS)
        sys.exit(1)

    playlist_entries = []
    for idx, input_video in enumerate(available, start=1):
        paths = video_paths(input_video)
        if not args.force and not needs_reprocess(input_video, paths["output_video"], paths["output_json"]):
            print(f"⏭️  Skipping {input_video} (up to date)")
            try:
                with open(paths["output_json"]) as f:
                    stats = json.load(f)
                duration = stats[-1]["timestamp"] if stats else 0
            except Exception:
                duration = 0
        else:
            meta = process_single_video(
                session, hog, input_video,
                paths["temp"], paths["output_video"], paths["output_json"],
            )
            duration = meta["duration"]

        base = paths["id"]
        playlist_entries.append({
            "id": base,
            "label": f"Camera {idx}",
            "video": f"/singapor/{base}_processed.mp4",
            "telemetry": f"/singapor/{base}_data.json",
            "duration": duration,
        })

    write_playlist(playlist_entries)
    print("\n✅ Done — refresh dashboard after processing completes.")


if __name__ == "__main__":
    main()
