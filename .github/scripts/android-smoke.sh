#!/bin/bash
# Installs the APK on a running Android emulator, drives the app through a few
# scenarios (with intents, like a user opening YouTube links) and saves screenshots
# + logs to ./smoke-android. Fails only when the app crashes.
set -u

APK="apk/DVDTube.apk"
PACKAGE="com.dangdvd.dvdtube"
OUT="$PWD/smoke-android"
mkdir -p "$OUT"

adb wait-for-device
adb install -r "$APK"
adb shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
adb logcat -G 16M 2>/dev/null || true
adb logcat -c

shot() {
  adb exec-out screencap -p > "$OUT/$1.png"
}

scenario() {
  local name=$1 wait=$2
  shift 2
  echo "=== scenario: $name"
  adb shell am start -W "$@" >/dev/null
  sleep "$wait"
  shot "$name"
  adb logcat -d -s DVDTube:D | tail -n 25 | sed 's/^/    /'
}

scenario home 30 -n "$PACKAGE/.MainActivity"
scenario search 20 -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "lofi hip hop" "$PACKAGE"
scenario channel 20 -a android.intent.action.VIEW -d "https://www.youtube.com/@NASA" "$PACKAGE"
scenario watch 45 -a android.intent.action.VIEW -d "https://www.youtube.com/watch?v=aqz-KE-bpKQ" "$PACKAGE"
adb shell input keyevent KEYCODE_BACK
sleep 4
shot mini
scenario shorts 35 -a android.intent.action.VIEW -d "https://www.youtube.com/shorts/jNQXAC9IVRw" "$PACKAGE"
# Home again with the HOME button: Picture in Picture should start if a video plays.
scenario watch2 25 -a android.intent.action.VIEW -d "https://www.youtube.com/watch?v=aqz-KE-bpKQ" "$PACKAGE"
adb shell input keyevent KEYCODE_HOME
sleep 6
shot pip

adb logcat -d > "$OUT/logcat.txt"
if adb shell pidof "$PACKAGE" >/dev/null; then echo "app process alive"; else echo "app process NOT running"; fi

echo "=== app log"
grep " DVDTube" "$OUT/logcat.txt" | tail -n 150

echo "=== crashes"
CRASH=0
if grep -q "FATAL EXCEPTION" "$OUT"/*.txt 2>/dev/null; then CRASH=1; fi
grep -A 40 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -n 120
adb logcat -d -b crash > "$OUT/crash.txt"
if [ -s "$OUT/crash.txt" ]; then
  CRASH=1
  head -n 120 "$OUT/crash.txt"
fi
if [ "$CRASH" = 1 ]; then
  echo "The app crashed"
  exit 1
fi
echo "no crash"
exit 0
