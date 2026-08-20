#!/bin/bash
# Shared environment for the EE-local vs deployed-prod parity comparison.
# `source env.sh` first; every other script sources it itself.
#
# This lives IN THE REPO on purpose. Two earlier copies lived in a session scratchpad under
# /private/tmp and were both wiped between sessions, taking the tab pin, vrt.py's align mode and
# strips.py's measured boxes with them. Shots and the venv stay disposable (see .gitignore).

QA="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
WORKTREE="$(cd "$QA/../../../.." && pwd)"
PY="$QA/venv/bin/python"
B="$HOME/.claude/skills/gstack/browse/dist/browse"
mkdir -p "$QA/shots"

# Pin the daemon state file. Without this, `browse` resolves it as
# <git-toplevel-or-cwd>/.gstack/browse.json — so a $B command run from another directory misses
# the live headed daemon, silently SPAWNS a second headless one, and every later call talks to
# that stray instead of the browser you are looking at. It cost a full relaunch once.
export BROWSE_STATE_FILE="$WORKTREE/.gstack/browse.json"

# --- The pair under comparison -------------------------------------------------------------
# Both projects are named `112-QA`. These are per-account ids: if the local stack is rebuilt or
# the project recreated, LOCAL_BASE changes. `doctor.sh` checks both before you trust a run.
LOCAL_BASE="http://localhost:3000/w/019d720c-aed1-7611-95d2-98166db228f4/p/01a011ce-17a2-7cd3-a222-6d3a94a22796"
PROD_BASE="https://eu.cloud.agenta.ai/w/01938831-7e29-7788-8fe8-c57904703742/p/01a011ce-2eb1-7e40-9348-b2652819ebbe"

# The matched agents: `New agent`, Anthropic / Haiku 4.5, same 139-word AGENTS.md on both.
# Finding a matched pair took the config strip from 32.70% to 2.72%, so always drive these two
# rather than whatever the sidebar happens to have open.
AGENT_PROD="01a01513-63df-70c1-80c8-ddb030627d1b"
AGENT_LOCAL="01a01513-541a-7b91-b2b2-3ce1058bbffd"
# The `PR reviewer` pair — the tools / approvals surface.
PRREV_PROD="01a01513-ad8e-7e20-8759-1f84b16b1319"
PRREV_LOCAL="01a01514-7575-7d23-a3a7-49dfd6a6aa52"

# --- Tab resolution ------------------------------------------------------------------------
# Tabs are resolved BY URL, never by a hardcoded id: ids shift whenever the browser is relaunched
# or a tab is opened. `closetab` is banned outright — closing a tab in this headed setup tore the
# whole browser context down once. Duplicate tabs are harmless; the DPR pin picks between them.
# Arda browses in this same window: never drive a tab you did not resolve.
LOCAL_MATCH="localhost:3000"
PROD_MATCH="eu.cloud.agenta.ai"

# DPR PIN. devicePixelRatio is per TAB, not per host: matching tabs can sit in different windows
# (or carry a `browse viewport` override). Measured live once — local tabs 2 and 3 at DPR 1, tab
# 12 at DPR 2, all three on the same playground URL. A DPR-1 tab captures 1800x942 where prod
# captures 3600x1884, so vrt.py sees two shapes and every strip is garbage — and "first match
# wins" had picked the DPR-1 one. Run `pin_tab local; pin_tab prod` after sourcing this.
WANT_DPR=2

dpr_of() {
  "$B" tab "$1" >/dev/null 2>&1
  "$B" js 'devicePixelRatio' 2>/dev/null | tail -1 | tr -d '"'
}

pin_tab() {
  case "$1" in
    local) _m="$LOCAL_MATCH" ;;
    prod)  _m="$PROD_MATCH" ;;
    *) echo "usage: pin_tab <local|prod>"; return 1 ;;
  esac
  rm -f "$QA/.tabpin.$1"
  for _cand in $("$B" tabs 2>/dev/null | grep -F "$_m" | sed -n 's/^[^0-9]*\[\([0-9]*\)\].*/\1/p'); do
    if [ "$(dpr_of "$_cand")" = "$WANT_DPR" ]; then
      printf '%s' "$_cand" > "$QA/.tabpin.$1"
      echo "  pinned $1 -> tab $_cand (DPR $WANT_DPR)"
      return 0
    fi
  done
  echo "  !! no $1 tab at DPR $WANT_DPR — captures would not be comparable"
  return 1
}

resolve_tab() {
  # resolve_tab <local|prod> -> the tab id, or empty if that env has no tab open.
  #
  # Retries: under load the daemon answers "running but not responding" for a few seconds and
  # `tabs` comes back empty. Failing on the first try made shot.sh report "no prod tab open" and
  # skip a capture on a browser that was perfectly fine — which looks exactly like the browser
  # having died. Only an empty result after ~30s means the tab really is gone.
  case "$1" in
    local) _m="$LOCAL_MATCH" ;;
    prod)  _m="$PROD_MATCH" ;;
    *) return 1 ;;
  esac
  _pin=$(cat "$QA/.tabpin.$1" 2>/dev/null)
  for _try in $(seq 1 10); do
    _matching=$("$B" tabs 2>/dev/null | grep -F "$_m" | sed -n 's/^[^0-9]*\[\([0-9]*\)\].*/\1/p')
    # Iterate through a command substitution, NOT `for _c in $_matching`: this file is sourced
    # from zsh as well as bash, and zsh does not word-split an unquoted parameter expansion — the
    # whole newline-joined list arrives as ONE word, the pin never matches, and resolve_tab
    # silently falls back to "first match wins", which is the DPR-1 tab the pin exists to avoid.
    if [ -n "$_pin" ]; then
      for _c in $(printf '%s\n' "$_matching"); do
        if [ "$_c" = "$_pin" ]; then printf '%s' "$_pin"; return 0; fi
      done
    fi
    _id=$(printf '%s\n' "$_matching" | head -1)
    if [ -n "$_id" ]; then printf '%s' "$_id"; return 0; fi
    sleep 3
  done
  return 1
}

use_tab() {
  # Switch to an env's tab and PROVE the switch took. `browse tab` silently no-ops during the
  # daemon's transient unresponsive windows, and the capture then comes from whichever tab was
  # already active — i.e. the SAME environment shot twice, which reads as a perfect score.
  # settings-tools.light once scored 0.00% whole-page that way, which is impossible when the two
  # builds stamp different versions in the rail. A false PASS is worse than a false finding.
  _t=$(resolve_tab "$1") || return 1
  [ -z "$_t" ] && return 1
  case "$1" in local) _want="$LOCAL_MATCH" ;; prod) _want="$PROD_MATCH" ;; esac
  for _try in $(seq 1 8); do
    "$B" tab "$_t" >/dev/null 2>&1
    case "$("$B" url 2>/dev/null)" in *"$_want"*) return 0 ;; esac
    sleep 2
  done
  return 1
}

base_for() { case "$1" in local) printf '%s' "$LOCAL_BASE" ;; prod) printf '%s' "$PROD_BASE" ;; esac; }
