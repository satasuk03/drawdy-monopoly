#!/bin/sh
# usage: shot.sh <name> <scenario> <theme> [click selectors joined by ||] [height] [lang]
H=${5:-900}
D=/Users/satasuk/Desktop/dev/drawdy
URL="file://$D/scripts/webview-harness.html?s=$2&theme=$3&lang=${6:-}&click=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$4")"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=$D/.gallery/panel-$1.png --window-size=360,$H --virtual-time-budget=3000 --hide-scrollbars "$URL" >/dev/null 2>&1
