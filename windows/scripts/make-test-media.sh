#!/usr/bin/env bash
# Generates local test media for running the player in mock mode (no YouTube access):
# YouTube-like single-file DASH formats (fragmented MP4 with one sidx / WebM with Cues),
# a muxed progressive MP4 (like itag 18), a vertical "Shorts" clip and storyboard sprite
# sheets. Writes everything to src/renderer/public/dev/ (gitignored) plus media.json, which
# the mock player API reads to fill PlayerInfo.adaptiveFormats with real byte ranges.
#
#   bash scripts/make-test-media.sh            # needs ffmpeg + python3
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=src/renderer/public/dev
FFMPEG=${FFMPEG:-ffmpeg}
DURATION=${DURATION:-90}
SHORT_DURATION=${SHORT_DURATION:-20}
FONT=$(fc-match -f '%{file}' 'DejaVu Sans:bold' 2>/dev/null || true)

mkdir -p "$OUT/sb" "$OUT/hls"
rm -f "$OUT"/*.mp4 "$OUT"/*.webm "$OUT"/sb/*.jpg "$OUT"/hls/* "$OUT"/media.json

ff() { "$FFMPEG" -hide_banner -loglevel error -y "$@"; }

# Text burnt into the picture so quality switches are visible in screenshots.
label() {
  if [ -n "$FONT" ]; then
    echo "drawtext=fontfile=$FONT:text='$1  %{pts\\:hms}':fontsize=$2:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=h-th-$2"
  else
    echo "null"
  fi
}

# Fragmented MP4 like YouTube's DASH files: ftyp + moov(mvex) + one global sidx + moof/mdat
# pairs, one fragment per 2 s GOP.
FRAG="-movflags +frag_keyframe+empty_moov+default_base_moof+global_sidx"
# Audio has no video keyframes to cut at: ~2 s fragments by duration instead.
AFRAG="-movflags +empty_moov+default_base_moof+global_sidx -frag_duration 2000000"

video_mp4() { # name width height fps bitrate
  local name=$1 w=$2 h=$3 fps=$4 rate=$5
  ff -f lavfi -i "testsrc2=d=$DURATION:s=${w}x${h}:r=$fps" \
    -vf "$(label "${h}p${fps/30/}" $((h / 18)))" \
    -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p -b:v "$rate" -maxrate "$rate" -bufsize "$rate" \
    -g $((fps * 2)) -keyint_min $((fps * 2)) -sc_threshold 0 -an $FRAG -f mp4 "$OUT/$name"
}

echo "• video (H.264)…"
video_mp4 video_360.mp4 640 360 30 400k
video_mp4 video_720.mp4 1280 720 30 1200k
video_mp4 video_1080.mp4 1920 1080 60 2200k

echo "• video (VP9 WebM)…"
ff -f lavfi -i "testsrc2=d=$DURATION:s=854x480:r=30" -vf "$(label "480p VP9" 26)" \
  -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1 -b:v 700k -g 60 -keyint_min 60 -an \
  -f webm -dash 1 -cluster_time_limit 2000 "$OUT/video_480.webm"

echo "• audio…"
ff -f lavfi -i "sine=f=330:b=2:d=$DURATION" -ac 2 -c:a aac -b:a 128k $AFRAG -f mp4 "$OUT/audio_vi.mp4"
ff -f lavfi -i "sine=f=550:b=1:d=$DURATION" -ac 2 -c:a aac -b:a 128k $AFRAG -f mp4 "$OUT/audio_en.mp4"
ff -f lavfi -i "sine=f=330:b=2:d=$DURATION" -ac 2 -c:a libopus -b:a 96k -f webm -dash 1 -cluster_time_limit 2000 "$OUT/audio_vi.webm"
ff -f lavfi -i "sine=f=550:b=1:d=$DURATION" -ac 2 -c:a libopus -b:a 96k -f webm -dash 1 -cluster_time_limit 2000 "$OUT/audio_en.webm"

echo "• muxed progressive (itag 18)…"
ff -f lavfi -i "testsrc2=d=$DURATION:s=640x360:r=30" -f lavfi -i "sine=f=330:b=2:d=$DURATION" \
  -vf "$(label "360p muxed" 20)" -c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p -b:v 500k \
  -c:a aac -b:a 96k -ac 2 -shortest -movflags +faststart "$OUT/muxed_360.mp4"

echo "• HLS (live / fallback)…"
# MPEG-TS segments like YouTube's HLS streams (shaka transmuxes them).
ff -i "$OUT/muxed_360.mp4" -c copy -bsf:v h264_mp4toannexb -f hls -hls_time 4 -hls_playlist_type vod \
  -hls_segment_filename "$OUT/hls/seg%03d.ts" "$OUT/hls/index.m3u8"

echo "• Shorts (vertical)…"
ff -f lavfi -i "gradients=d=$SHORT_DURATION:s=720x1280:r=30:speed=0.02" -vf "$(label "Shorts 9:16" 40)" \
  -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p -b:v 1200k -g 60 -keyint_min 60 -sc_threshold 0 -an \
  $FRAG -f mp4 "$OUT/short_1280.mp4"
ff -f lavfi -i "sine=f=440:b=3:d=$SHORT_DURATION" -ac 2 -c:a aac -b:a 128k $AFRAG -f mp4 "$OUT/short_audio.mp4"
ff -f lavfi -i "gradients=d=$SHORT_DURATION:s=360x640:r=30:speed=0.02" -f lavfi -i "sine=f=440:b=3:d=$SHORT_DURATION" \
  -vf "$(label "Shorts" 22)" -c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p -b:v 500k \
  -c:a aac -b:a 96k -ac 2 -shortest -movflags +faststart "$OUT/short_muxed.mp4"

echo "• storyboard…"
# One frame every 2 s, 160×90, 5×5 frames per sheet: M0.jpg, M1.jpg…
ff -i "$OUT/video_360.mp4" -vf "fps=1/2,scale=160:90,tile=5x5" -q:v 4 -start_number 0 "$OUT/sb/M%d.jpg"

echo "• byte ranges…"
python3 -I - "$OUT" "$DURATION" "$SHORT_DURATION" <<'PY'
import json, os, struct, sys

out, duration, short_duration = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])

def mp4_boxes(data, start=0, end=None):
    end = len(data) if end is None else end
    pos = start
    while pos + 8 <= end:
        size, kind = struct.unpack('>I4s', data[pos:pos + 8])
        header = 8
        if size == 1:
            size = struct.unpack('>Q', data[pos + 8:pos + 16])[0]
            header = 16
        elif size == 0:
            size = end - pos
        yield kind.decode('latin-1'), pos, size, header
        pos += size

def find_box(data, path, start=0, end=None):
    for kind, pos, size, header in mp4_boxes(data, start, end):
        if kind == path[0]:
            if len(path) == 1:
                return pos, size, header
            inner = pos + header
            if kind == 'stsd':
                inner += 8
            elif kind in ('avc1', 'mp4a'):
                inner += 78 if kind == 'avc1' else 28
            return find_box(data, path[1:], inner, pos + size)
    return None

def mp4_ranges(data):
    moov = sidx = None
    for kind, pos, size, header in mp4_boxes(data):
        if kind == 'moov':
            moov = (pos, size)
        elif kind == 'sidx' and sidx is None:
            sidx = (pos, size)
    if not moov or not sidx:
        raise SystemExit('missing moov/sidx')
    return {'start': 0, 'end': moov[0] + moov[1] - 1}, {'start': sidx[0], 'end': sidx[0] + sidx[1] - 1}

def avc_codec(data):
    box = find_box(data, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1', 'avcC'])
    if not box:
        return 'avc1.64001f'
    pos, size, header = box
    p, c, l = data[pos + header + 1], data[pos + header + 2], data[pos + header + 3]
    return 'avc1.%02x%02x%02x' % (p, c, l)

def ebml_id(data, pos):
    first = data[pos]
    length = 1
    mask = 0x80
    while length <= 4 and not first & mask:
        mask >>= 1
        length += 1
    return int.from_bytes(data[pos:pos + length], 'big'), length

def ebml_size(data, pos):
    first = data[pos]
    length = 1
    mask = 0x80
    while length <= 8 and not first & mask:
        mask >>= 1
        length += 1
    value = first & (mask - 1)
    for b in data[pos + 1:pos + length]:
        value = (value << 8) | b
    return value, length

def webm_ranges(data):
    pos = 0
    _, n = ebml_id(data, pos)
    size, m = ebml_size(data, pos + n)
    pos += n + m + size  # EBML header
    seg_id, n = ebml_id(data, pos)
    assert seg_id == 0x18538067, 'no Segment'
    _, m = ebml_size(data, pos + n)
    pos += n + m
    first_cluster = cues = None
    while pos < len(data):
        eid, n = ebml_id(data, pos)
        size, m = ebml_size(data, pos + n)
        if eid == 0x1F43B675 and first_cluster is None:
            first_cluster = pos
        if eid == 0x1C53BB6B:
            cues = (pos, n + m + size)
        pos += n + m + size
    if first_cluster is None or cues is None:
        raise SystemExit('missing Cluster/Cues')
    init_end = min(first_cluster, cues[0]) - 1
    return {'start': 0, 'end': init_end}, {'start': cues[0], 'end': cues[0] + cues[1] - 1}

def entry(name, itag, mime, bitrate, **extra):
    path = os.path.join(out, name)
    data = open(path, 'rb').read()
    init, index = webm_ranges(data) if name.endswith('.webm') else mp4_ranges(data)
    if mime == 'avc':
        mime = 'video/mp4; codecs="%s"' % avc_codec(data)
    item = {'file': name, 'itag': itag, 'mimeType': mime, 'bitrate': bitrate, 'contentLength': len(data),
            'initRange': init, 'indexRange': index}
    item.update(extra)
    print('  %-16s init %d-%d  index %d-%d  (%d bytes)' % (name, init['start'], init['end'], index['start'], index['end'], len(data)))
    return item

formats = [
    entry('video_360.mp4', 134, 'avc', 400000, width=640, height=360, fps=30, qualityLabel='360p'),
    entry('video_480.webm', 244, 'video/webm; codecs="vp9"', 700000, width=854, height=480, fps=30, qualityLabel='480p'),
    entry('video_720.mp4', 136, 'avc', 1200000, width=1280, height=720, fps=30, qualityLabel='720p'),
    entry('video_1080.mp4', 299, 'avc', 2200000, width=1920, height=1080, fps=60, qualityLabel='1080p60'),
    entry('audio_vi.mp4', 140, 'audio/mp4; codecs="mp4a.40.2"', 128000, audioSampleRate=44100, audioChannels=2,
          isDefaultAudio=True, audioLanguage='vi', audioTrackName='Tiếng Việt (gốc)'),
    entry('audio_vi.webm', 251, 'audio/webm; codecs="opus"', 96000, audioSampleRate=48000, audioChannels=2,
          isDefaultAudio=True, audioLanguage='vi', audioTrackName='Tiếng Việt (gốc)'),
    entry('audio_en.mp4', 140, 'audio/mp4; codecs="mp4a.40.2"', 128000, audioSampleRate=44100, audioChannels=2,
          isDefaultAudio=False, audioLanguage='en', audioTrackName='English'),
    entry('audio_en.webm', 251, 'audio/webm; codecs="opus"', 96000, audioSampleRate=48000, audioChannels=2,
          isDefaultAudio=False, audioLanguage='en', audioTrackName='English'),
]
shorts = [
    entry('short_1280.mp4', 136, 'avc', 1200000, width=720, height=1280, fps=30, qualityLabel='720p'),
    entry('short_audio.mp4', 140, 'audio/mp4; codecs="mp4a.40.2"', 128000, audioSampleRate=44100, audioChannels=2,
          isDefaultAudio=True),
]
sheets = len([f for f in os.listdir(os.path.join(out, 'sb')) if f.endswith('.jpg')])
media = {
    'duration': duration,
    'formats': formats,
    'muxed': [{'file': 'muxed_360.mp4', 'itag': 18, 'mimeType': 'video/mp4; codecs="avc1.4d401e, mp4a.40.2"',
               'bitrate': 600000, 'width': 640, 'height': 360, 'fps': 30, 'qualityLabel': '360p',
               'contentLength': os.path.getsize(os.path.join(out, 'muxed_360.mp4'))}],
    'shorts': {'duration': short_duration, 'formats': shorts,
               'muxed': [{'file': 'short_muxed.mp4', 'itag': 18, 'mimeType': 'video/mp4; codecs="avc1.4d401e, mp4a.40.2"',
                          'bitrate': 600000, 'width': 360, 'height': 640, 'fps': 30, 'qualityLabel': '360p'}]},
    # Same layout as YouTube's storyboard spec: 160×90 frames, 5×5 per sheet, one every 2 s.
    'storyboard': {'path': 'sb/$N.jpg', 'width': 160, 'height': 90, 'count': int(duration // 2), 'columns': 5,
                   'rows': 5, 'intervalMs': 2000, 'sheets': sheets},
}
json.dump(media, open(os.path.join(out, 'media.json'), 'w'), ensure_ascii=False, indent=1)
print('  wrote', os.path.join(out, 'media.json'))
PY

du -sh "$OUT" | awk '{print "Done: " $1 " in " $2}'
