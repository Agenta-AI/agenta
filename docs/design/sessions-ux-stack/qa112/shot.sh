#!/bin/bash
# shot.sh <slug> <local|prod> [light|dark]
#
# Captures ONE classified state of the CURRENT page in ONE env. The slug encodes the
# classification, e.g. `chat.dark.tool-step-expanded`. Deliberately does NOT navigate: the caller
# puts the page in the exact state first (open the drawer, seed the data, expand the row), then
# calls this. Same slug for both envs; vrt.py pairs them by name.
source "$(dirname "$0")/env.sh"
SLUG="$1"; ENV="$2"; THEME="$3"

case "$ENV" in
  local|prod) ;;
  *) echo "usage: shot.sh <slug> <local|prod> [light|dark]"; exit 1 ;;
esac

if ! use_tab "$ENV"; then
  echo "  !! $ENV $SLUG: could not switch to the $ENV tab (active is $($B url 2>/dev/null)) — NOTHING captured"
  exit 1
fi

if [ -n "$THEME" ]; then
  $B js "localStorage.setItem('agenta-theme',JSON.stringify('$THEME'));'set'" >/dev/null 2>&1
  $B reload >/dev/null 2>&1
  sleep 4
fi

# Settle gate. Neither a fixed sleep nor a DOM-node count is enough — both passed while the local
# dev build was still painting and produced a page of phantom "missing row" findings twice. The
# only reliable test is the pixels: shoot repeatedly until two consecutive frames agree.
# Byte-identity is too strict (a small live widget, ~490px / 0.007%, never stops repainting on
# either build), so settle on "quiet", not "frozen".
_a="$QA/shots/.settle.$ENV.a.png"; _b="$QA/shots/.settle.$ENV.b.png"
rm -f "$_a" "$_b"
$B screenshot --viewport "$_a" >/dev/null 2>&1
_settled=0
for _i in $(seq 1 25); do
  sleep 2
  $B screenshot --viewport "$_b" >/dev/null 2>&1
  _d=$("$PY" - "$_a" "$_b" <<'PY' 2>/dev/null
import sys
import numpy as np
from PIL import Image
try:
    a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.int16)
    b = np.asarray(Image.open(sys.argv[2]).convert("RGB")).astype(np.int16)
    print(10**9 if a.shape != b.shape else int((np.abs(a - b).max(axis=2) > 24).sum()))
except Exception:
    print(10**9)
PY
)
  case "$_d" in ''|*[!0-9]*) _d=1000000000 ;; esac
  # 2000px ~= 4x the known-live widget, still far below any real render change.
  if [ "$_d" -lt 2000 ]; then _settled=1; break; fi
  mv "$_b" "$_a"
done
rm -f "$_a" "$_b"
[ "$_settled" -eq 0 ] && echo "  ~~ $ENV $SLUG: never went quiet (last delta ${_d}px) — capture may be mid-render"

# Skeletons are STATIC, so they sail through the pixel-quiet gate above and get captured as if
# they were the page. That invented a whole-block finding three times (a sessions list, an agent
# Home, an observability table) — `/apps` read 8.64% with a skeleton captured and 1.84% without.
# Wait them out, but bounded: some surfaces legitimately keep one, and a capture with a skeleton
# still beats no capture.
for _i in $(seq 1 20); do
  _sk=$($B js "document.querySelectorAll('[class*=skeleton i],[data-slot*=skeleton],.ant-skeleton,[aria-busy=true]').length" 2>/dev/null | tail -1 | tr -d '"')
  case "$_sk" in ''|*[!0-9]*) _sk=0 ;; esac
  [ "$_sk" -eq 0 ] && break
  sleep 2
done
[ "${_sk:-0}" -ne 0 ] && echo "  ~~ $ENV $SLUG: still $_sk skeleton node(s) after 40s — capture may be a loading state"

# Park the pointer so stray hover states don't leak in, and hide the Next.js dev-tools badge: it
# exists only under `next dev`, sits on top of the account chip, and generated a phantom diff
# region every run. Hiding the shadow HOST (rather than painting the box black) also recovers the
# chip pixels underneath, so that area stays comparable. No-op on prod.
$B js "document.querySelectorAll('nextjs-portal').forEach(e=>{e.style.display='none'});window.scrollTo(0,0);'ok'" >/dev/null 2>&1

URL=$($B url 2>/dev/null)
$B screenshot --viewport "$QA/shots/$SLUG.$ENV.png" >/dev/null 2>&1
echo "  $ENV  $SLUG  <- ${URL##*/p/*/}"
