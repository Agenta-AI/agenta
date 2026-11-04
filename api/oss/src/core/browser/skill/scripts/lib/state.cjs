"use strict";

// Saved sign-ins: Playwright's storage state ({cookies, origins}). Several sessions of one agent
// share the file, so a save writes only what this browser changed since it last loaded or saved.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const EMPTY = { cookies: [], origins: [] };

// Nothing marks an entry as a sign-in. Tokens run to a few KB; larger entries are a site's cache
// (Wikipedia keeps 1 MB of scripts), and every save stores the whole file again.
const MAX_SAVED_ITEM_CHARS = 32 * 1024;

function withoutCaches(state) {
  const origins = (state.origins || [])
    .map((origin) => ({
      ...origin,
      localStorage: (origin.localStorage || []).filter(
        (item) => item.value.length <= MAX_SAVED_ITEM_CHARS,
      ),
    }))
    .filter((origin) => origin.localStorage.length);
  return { ...state, origins };
}

const cookieKey = (c) => `${c.name}\u0000${c.domain}\u0000${c.path}`;
const originKey = (o) => o.origin;

function byKey(items, keyOf) {
  return new Map((items || []).map((item) => [keyOf(item), item]));
}

// Three-way merge per entry: where this browser changed an entry (added, changed or removed it)
// since `base`, its value wins; everywhere else the file on disk wins.
function mergeEntries(base, ours, disk, keyOf) {
  const b = byKey(base, keyOf);
  const o = byKey(ours, keyOf);
  const merged = byKey(disk, keyOf);
  for (const key of new Set([...b.keys(), ...o.keys()])) {
    const before = b.get(key);
    const now = o.get(key);
    if (JSON.stringify(before) === JSON.stringify(now)) continue;
    if (now === undefined) merged.delete(key);
    else merged.set(key, now);
  }
  return [...merged.values()];
}

function sameEntries(a, b, keyOf) {
  const x = byKey(a, keyOf);
  const y = byKey(b, keyOf);
  if (x.size !== y.size) return false;
  for (const [key, value] of x)
    if (JSON.stringify(value) !== JSON.stringify(y.get(key))) return false;
  return true;
}

function sameState(a, b) {
  a = a || EMPTY;
  b = b || EMPTY;
  return (
    sameEntries(a.cookies, b.cookies, cookieKey) &&
    sameEntries(a.origins, b.origins, originKey)
  );
}

function mergeState(base, ours, disk) {
  base = base || EMPTY;
  disk = disk || EMPTY;
  return {
    cookies: mergeEntries(base.cookies, ours.cookies, disk.cookies, cookieKey),
    origins: mergeEntries(base.origins, ours.origins, disk.origins, originKey),
  };
}

function readState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return state && Array.isArray(state.cookies) ? state : undefined;
  } catch {
    return undefined;
  }
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// One browser context's view of the file. `base` is what it last loaded or wrote.
function stateStore(file) {
  let base = readState(file);
  return {
    file,
    loaded: () => base,
    // Returns false when this browser changed nothing, so a read never rewrites the file.
    save(state) {
      const ours = withoutCaches(state);
      if (sameState(base, ours)) return false;
      const merged = mergeState(base, ours, readState(file));
      writeAtomic(file, JSON.stringify(merged));
      base = ours;
      return true;
    },
  };
}

module.exports = { MAX_SAVED_ITEM_CHARS, mergeState, stateStore };
