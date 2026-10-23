#!/bin/bash
# Boots an iOS simulator, runs the app through a few scenarios and saves
# screenshots + diagnostic logs to ./smoke (uploaded as a CI artifact).
set -u

APP="build-sim/Build/Products/Debug-iphonesimulator/DVDYoutube.app"
BUNDLE="com.dangdvd.dvdtube"
OUT="$PWD/smoke"
mkdir -p "$OUT"

UDID=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
phones = [d for runtime, items in devices.items() if "iOS" in runtime for d in items if d["name"].startswith("iPhone")]
# Prefer a current full-screen iPhone over the SE.
phones.sort(key=lambda d: ("SE" not in d["name"], "Pro" in d["name"] and "Max" not in d["name"], d["name"]))
print(phones[-1]["udid"] if phones else "")
')
if [ -z "$UDID" ]; then
  echo "No iPhone simulator available"
  exit 1
fi
echo "Using simulator $UDID"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 || true
xcrun simctl install "$UDID" "$APP"

run() {
  local name=$1 wait=$2
  shift 2
  echo "=== scenario: $name"
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl launch --stdout="$OUT/$name.stdout.log" --stderr="$OUT/$name.log" \
    "$UDID" "$BUNDLE" -DVDTubeVerbose "$@"
  sleep "$wait"
  xcrun simctl io "$UDID" screenshot "$OUT/$name.png"
  sed 's/^/    /' "$OUT/$name.log" | uniq | tail -n 40
}

run home 30
run search 20 -DVDTubeDemoSearch "lofi hip hop"
run watch 45 -DVDTubeDemoVideo "aqz-KE-bpKQ"
run channel 20 -DVDTubeDemoChannel "@NASA"
run shorts 35 -DVDTubeDemoTab shorts
run livechat 75 -DVDTubeDemoLiveChat
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true

echo "=== summary"
grep -h "HTTP" "$OUT"/*.log | sed -E 's/, [0-9]+ bytes//' | sort | uniq -c | sort -rn | head -n 30
grep -h -E "stream |item |playing |failed|short |web |live chat|chat replay|error:" "$OUT"/*.log | head -n 80
exit 0
