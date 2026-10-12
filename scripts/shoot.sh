#!/bin/sh
# Screenshot helper for the art gallery: scripts/shoot.sh <id|index> [size]
cd "$(dirname "$0")/../.gallery" || exit 1
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
N=$1; S=${2:-1220}
if [ "$N" = index ]; then
  "$C" --headless --disable-gpu --hide-scrollbars --screenshot=$PWD/index.png --window-size=1500,4000 "file://$PWD/index.html" >/dev/null 2>&1
else
  echo "<body style=margin:0><img src=$N-board.svg width=$S height=$S></body>" > $N-shot.html
  "$C" --headless --disable-gpu --hide-scrollbars --screenshot=$PWD/$N-board.png --window-size=$S,$S "file://$PWD/$N-shot.html" >/dev/null 2>&1
fi
