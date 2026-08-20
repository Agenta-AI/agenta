#!/bin/bash
# go.sh <local|prod> <visible label> <expected url fragment>
#
# Navigates by CLICKING the thing a user would click, then asserts the landed URL. Use this when
# the point is that the control navigates (nav rows, cards, tabs); use goto.sh when you just need
# the page in front of you.
#
# Worth knowing: on /agents the two builds differ here. Local's agent cards are anchors; prod's
# are click-handled divs that land on `/overview`. So "click the card" is not the same DOM
# operation on both sides — match by LABEL, never by selector shape.
source "$(dirname "$0")/env.sh"
ENV="$1"; LABEL="$2"; WANT="$3"
[ -z "$WANT" ] && { echo "usage: go.sh <local|prod> <label> <urlFragment>"; exit 1; }

use_tab "$ENV" || { echo "  !! no $ENV tab"; exit 1; }

# Prefer a real anchor/button whose text matches; fall back to any clickable element. Print WHAT
# was matched — a selector that quietly matched the wrong element inverted a conclusion twice.
$B js "
const want = $(printf '%s' "$LABEL" | "$PY" -c 'import json,sys;print(json.dumps(sys.stdin.read()))');
const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 };
const exact = [...document.querySelectorAll('a,button,[role=tab],[role=menuitem],li,div')]
  .filter(e => vis(e) && (e.innerText || '').trim() === want);
const loose = [...document.querySelectorAll('a,button,[role=tab],[role=menuitem],li,div')]
  .filter(e => vis(e) && (e.innerText || '').trim().startsWith(want));
const el = exact[0] || loose[0];
if (!el) { 'NOMATCH' } else {
  const r = el.getBoundingClientRect();
  el.click();
  JSON.stringify({matched: el.tagName + '.' + (el.className||'').toString().slice(0,40),
                  rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]});
}" 2>&1 | tail -1

for _i in $(seq 1 20); do
  sleep 2
  GOT=$($B url 2>/dev/null)
  case "$GOT" in *"$WANT"*) echo "  OK   $ENV '$LABEL' -> $WANT"; exit 0 ;; esac
done
echo "  MISS $ENV '$LABEL' wanted '$WANT', got: $GOT"; exit 1
