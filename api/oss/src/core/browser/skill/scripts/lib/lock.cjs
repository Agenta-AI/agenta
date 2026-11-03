"use strict";

const fs = require("node:fs");

// Alive and still one of ours. Pids restart low after a sandbox stop and start, so a stale pid
// file can name an unrelated process; on Linux its command line tells them apart.
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code !== "EPERM") return false;
  }
  let cmdline;
  try {
    cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return true;
  }
  return cmdline.includes("agenta-browser");
}

function readPid(file) {
  try {
    return Number.parseInt(fs.readFileSync(file, "utf8"), 10);
  } catch {
    return NaN;
  }
}

// A lock file that holds its owner's pid. A lock whose owner died is taken over; a lock with no
// pid yet is only stale once it is older than `emptyStaleMs` (its owner may be mid-write).
function tryLock(file, { emptyStaleMs = 10_000 } = {}) {
  try {
    const fd = fs.openSync(file, "wx", 0o600);
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const seen = fs.statSync(file, { throwIfNoEntry: false });
  if (!seen) return tryLock(file, { emptyStaleMs });
  const owner = readPid(file);
  if (pidAlive(owner)) return false;
  if (Number.isNaN(owner) && Date.now() - seen.mtimeMs < emptyStaleMs) return false;
  const stale = `${file}.stale.${process.pid}`;
  try {
    fs.renameSync(file, stale);
  } catch {
    return false;
  }
  // Another taker may have replaced the stale lock with its own live one before our rename.
  if (fs.statSync(stale).ino !== seen.ino) {
    try {
      fs.linkSync(stale, file);
    } catch {}
    fs.rmSync(stale, { force: true });
    return false;
  }
  fs.rmSync(stale, { force: true });
  return tryLock(file, { emptyStaleMs });
}

async function withLock(file, timeoutMs, work) {
  const deadline = Date.now() + timeoutMs;
  while (!tryLock(file)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}.`);
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return await work();
  } finally {
    if (readPid(file) === process.pid) fs.rmSync(file, { force: true });
  }
}

module.exports = { pidAlive, readPid, tryLock, withLock };
