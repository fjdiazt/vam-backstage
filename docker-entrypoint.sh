#!/bin/sh
set -eu

export DISPLAY=:99
Xvfb "$DISPLAY" -screen 0 1280x1024x24 -nolisten tcp &

attempt=0
while [ ! -S /tmp/.X11-unix/X99 ] && [ "$attempt" -lt 50 ]; do
  attempt=$((attempt + 1))
  sleep 0.1
done

test -S /tmp/.X11-unix/X99
exec /opt/vam-backstage/vam-backstage --no-sandbox "$@"
