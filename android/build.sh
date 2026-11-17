#!/bin/bash
# Byggir appið án Android Studio.
# Notkun:  ./build.sh          (debug-APK)
#          ./build.sh release  (release-APK)
set -e
cd "$(dirname "$0")"

# Java sem fylgir Android Studio (Java er ekki uppsett kerfislega á þessari vél).
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

if [ "$1" = "release" ]; then
  ./gradlew assembleRelease
  echo "APK: app/build/outputs/apk/release/"
else
  ./gradlew assembleDebug
  echo "APK: app/build/outputs/apk/debug/app-debug.apk"
fi
