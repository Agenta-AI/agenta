/**
 * In-container driver for the shared-auth-home storage experiment.
 *
 * Runs INSIDE the runner container of a compose stack, on the REAL geesefs mount path with the
 * REAL production flags (see services/runner/src/engines/sandbox_agent/mount.ts geesefsArgs).
 * It mounts the same object-store prefix twice, then measures what one mount sees when the other
 * writes.
 *
 * Never run this against a real session prefix. It writes under a throwaway `research/` prefix.
 *
 * Env in:
 *   S3_ENDPOINT, S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   EXP_PREFIX  (key prefix under the bucket, no leading or trailing slash)
 *   EXP_ROOT    (host-side scratch dir for mountpoints and logs, default /tmp/mount-exp)
 *   OUT_JSON    (path to write the machine-readable result, default $EXP_ROOT/results.json)
 * Env out: writes OUT_JSON and prints a human log on stderr.
 */

import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

const ENDPOINT = process.env.S3_ENDPOINT || "http://seaweedfs:8333";
const BUCKET = process.env.S3_BUCKET || "agenta-store";
const REGION = process.env.S3_REGION || "us-east-1";
const AK = process.env.AWS_ACCESS_KEY_ID || "";
const SK = process.env.AWS_SECRET_ACCESS_KEY || "";
const PREFIX = (process.env.EXP_PREFIX || "").replace(/^\/+|\/+$/g, "");
const ROOT = process.env.EXP_ROOT || "/tmp/mount-exp";
const OUT_JSON = process.env.OUT_JSON || join(ROOT, "results.json");

if (!AK || !SK || !PREFIX) {
  console.error("missing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / EXP_PREFIX");
  process.exit(2);
}

const MNT_A = join(ROOT, "a");
const MNT_B = join(ROOT, "b");
const LOG_A = join(ROOT, "geesefs-a.log");
const LOG_B = join(ROOT, "geesefs-b.log");

const results = {
  meta: {
    startedAt: new Date().toISOString(),
    endpoint: ENDPOINT,
    bucket: BUCKET,
    region: REGION,
    prefix: PREFIX,
    geesefsVersion: null,
    geesefsArgv: null,
    seaweedfsVersion: null,
  },
  cells: {},
};

function log(...a) {
  console.error(`[${new Date().toISOString()}]`, ...a);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ---------------------------------------------------------------- SigV4 S3 --

function sha256hex(b) {
  return crypto.createHash("sha256").update(b).digest("hex");
}
function hmac(key, s) {
  return crypto.createHmac("sha256", key).update(s).digest();
}
function encodeSeg(s) {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** One signed S3 request. `key` is the object key WITHOUT the bucket. */
async function s3(method, key, opts = {}) {
  const { body = "", query = {}, headers = {} } = opts;
  const path =
    "/" + encodeSeg(BUCKET) + (key ? "/" + key.split("/").map(encodeSeg).join("/") : "");
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${encodeSeg(k)}=${encodeSeg(String(query[k]))}`)
    .join("&");
  const url = new URL(ENDPOINT);
  const host = url.host;
  const amzdate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const datestamp = amzdate.slice(0, 8);
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const payloadHash = sha256hex(payload);

  const allHeaders = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzdate,
    ...headers,
  };
  const signedNames = Object.keys(allHeaders)
    .map((h) => h.toLowerCase())
    .sort();
  const canonHeaders =
    signedNames
      .map((h) => {
        const found = Object.keys(allHeaders).find((k) => k.toLowerCase() === h);
        return `${h}:${String(allHeaders[found]).trim()}`;
      })
      .join("\n") + "\n";
  const signedHeaders = signedNames.join(";");
  const canonicalRequest = [
    method,
    path,
    qs,
    canonHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${datestamp}/${REGION}/s3/aws4_request`;
  const toSign = [
    "AWS4-HMAC-SHA256",
    amzdate,
    scope,
    sha256hex(Buffer.from(canonicalRequest)),
  ].join("\n");
  let k = hmac(Buffer.from("AWS4" + SK), datestamp);
  k = hmac(k, REGION);
  k = hmac(k, "s3");
  k = hmac(k, "aws4_request");
  const signature = crypto.createHmac("sha256", k).update(toSign).digest("hex");
  const auth =
    `AWS4-HMAC-SHA256 Credential=${AK}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`${url.origin}${path}${qs ? "?" + qs : ""}`, {
    method,
    headers: { ...allHeaders, authorization: auth },
    body: method === "GET" || method === "HEAD" ? undefined : payload,
  });
  const text = method === "HEAD" ? "" : await res.text();
  return {
    status: res.status,
    etag: res.headers.get("etag"),
    contentLength: res.headers.get("content-length"),
    body: text,
  };
}

async function s3Get(key) {
  return s3("GET", key);
}
async function s3Put(key, body, headers = {}) {
  return s3("PUT", key, { body, headers });
}
async function s3List(prefix) {
  const r = await s3("GET", "", {
    query: { "list-type": "2", prefix, "max-keys": "100" },
  });
  const keys = [...r.body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  return { status: r.status, keys };
}
async function s3Delete(key) {
  return s3("DELETE", key);
}

// ------------------------------------------------------------------- mounts --

/**
 * The EXACT production argv. Mirrors geesefsArgs() in mount.ts.
 *
 * EXP_EXTRA_GEESEFS_ARGS appends diagnostic flags (for example `--debug_s3`). It is EMPTY by
 * default, so the measured run uses the production flags and nothing else. Any result taken with
 * it set must say so.
 */
function geesefsArgv(mnt) {
  const extra = (process.env.EXP_EXTRA_GEESEFS_ARGS || "").split(/\s+/).filter(Boolean);
  return [
    ...extra,
    "--endpoint",
    ENDPOINT,
    "--region",
    REGION,
    "--no-detect",
    "--fsync-on-close",
    "-f",
    "-o",
    "allow_other",
    `${BUCKET}:${PREFIX}`,
    mnt,
  ];
}

function mountAlive(mnt) {
  try {
    execFileSync("mountpoint", ["-q", mnt]);
  } catch {
    return false;
  }
  try {
    execFileSync("ls", ["-A", mnt], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function unmount(mnt) {
  try {
    execFileSync("fusermount", ["-uz", mnt], { stdio: "ignore" });
  } catch {
    /* best effort */
  }
}

const children = [];

async function mount(mnt, logFile) {
  mkdirSync(mnt, { recursive: true });
  unmount(mnt);
  const argv = geesefsArgv(mnt);
  results.meta.geesefsArgv = ["geesefs", ...argv].join(" ");
  const out = openSync(logFile, "a");
  const child = spawn("geesefs", argv, {
    env: { ...process.env, AWS_ACCESS_KEY_ID: AK, AWS_SECRET_ACCESS_KEY: SK },
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  children.push({ child, mnt });
  for (let i = 0; i < 40; i++) {
    if (mountAlive(mnt)) {
      log(`mounted ${BUCKET}:${PREFIX} -> ${mnt}`);
      return true;
    }
    await sleep(500);
  }
  throw new Error(`mount never came alive: ${mnt} (see ${logFile})`);
}

function cleanupMounts() {
  for (const { child, mnt } of children) {
    unmount(mnt);
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

// ------------------------------------------------------------------- file IO --

/** Write a file the way a harness rewrites a token file: O_TRUNC, write, fsync, close. */
function rewrite(path, content) {
  const fd = openSync(path, "w", 0o600);
  writeSync(fd, content);
  fsyncSync(fd);
  closeSync(fd);
}

function readOr(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    return { error: err.code || String(err) };
  }
}

/** setfattr is not in the image; use python3's os.setxattr for the geesefs .invalidate xattr. */
function invalidate(path) {
  try {
    execFileSync(
      "python3",
      ["-c", "import os,sys;os.setxattr(sys.argv[1], b'.invalidate', b'1')", path],
      { stdio: "pipe" },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.stderr || err).slice(0, 300) };
  }
}

// --------------------------------------------------------------------- cells --

/**
 * CELL 1 - cold reader. Mount A writes; mount B is mounted AFTER the write.
 * A fresh mount has no cache, so this isolates "does the store have it" from "does the cache lie".
 */
async function cellColdRead() {
  const name = "auth-cold.json";
  const payload = JSON.stringify({ cell: "cold", token: "T-cold", at: now() });
  rewrite(join(MNT_A, name), payload);
  const store = await s3Get(`${PREFIX}/${name}`);
  // A mount created AFTER the write has no cache, which is the point of this cell.
  const mntCold = join(ROOT, "cold");
  await mount(mntCold, join(ROOT, "geesefs-cold.log"));
  const seen = readOr(join(mntCold, name));
  return {
    wroteOnA: payload,
    storeStatus: store.status,
    storeBody: store.body,
    readOnFreshB: seen,
    match: seen === payload,
  };
}

/**
 * CELL 2 - warm reader staleness. B reads the file first (warming its cache), then A rewrites it,
 * then B polls. Measures how long B keeps serving the OLD bytes after the store already has the
 * new ones. This is the number that decides whether a shared auth.json is safe.
 */
async function cellWarmStaleness(rounds = 2, capMs = 150_000) {
  const name = "auth-warm.json";
  const pathA = join(MNT_A, name);
  const pathB = join(MNT_B, name);
  const out = [];
  rewrite(pathA, JSON.stringify({ seq: 0 }));
  await sleep(2000);
  for (let round = 1; round <= rounds; round++) {
    const warm = readOr(pathB); // warm B's cache on the current value
    const payload = JSON.stringify({ seq: round, at: now() });
    rewrite(pathA, payload);
    // Confirm the store really holds the new bytes before timing B's staleness.
    let storeAt = null;
    for (let i = 0; i < 60; i++) {
      const g = await s3Get(`${PREFIX}/${name}`);
      if (g.status === 200 && g.body === payload) {
        storeAt = now();
        break;
      }
      await sleep(250);
    }
    const t0 = storeAt ?? now();
    let seenAt = null;
    const staleSamples = [];
    while (now() - t0 < capMs) {
      const v = readOr(pathB);
      if (v === payload) {
        seenAt = now();
        break;
      }
      staleSamples.push({ dtMs: now() - t0, value: typeof v === "string" ? v : v });
      await sleep(250);
    }
    out.push({
      round,
      warmedWith: warm,
      wrote: payload,
      storeConfirmedMs: storeAt ? storeAt - t0 : null,
      visibleOnBAfterMs: seenAt ? seenAt - t0 : null,
      timedOut: seenAt === null,
      staleReadCount: staleSamples.length,
      firstStale: staleSamples[0] ?? null,
      lastStale: staleSamples[staleSamples.length - 1] ?? null,
    });
    log(`warm round ${round}: visible after ${out[out.length - 1].visibleOnBAfterMs} ms`);
    await sleep(2000);
  }
  return out;
}

/**
 * CELL 3 - the documented escape hatch. Same as cell 2, but B sets the `.invalidate` xattr
 * (geesefs --refresh-attr, default ".invalidate") before each read.
 */
async function cellInvalidate(rounds = 2, capMs = 90_000) {
  const name = "auth-invalidate.json";
  const pathA = join(MNT_A, name);
  const pathB = join(MNT_B, name);
  const out = [];
  rewrite(pathA, JSON.stringify({ seq: 0 }));
  await sleep(2000);
  let xattrProbe = null;
  for (let round = 1; round <= rounds; round++) {
    readOr(pathB);
    const payload = JSON.stringify({ seq: round, at: now() });
    rewrite(pathA, payload);
    let storeAt = null;
    for (let i = 0; i < 60; i++) {
      const g = await s3Get(`${PREFIX}/${name}`);
      if (g.status === 200 && g.body === payload) {
        storeAt = now();
        break;
      }
      await sleep(250);
    }
    const t0 = storeAt ?? now();
    let seenAt = null;
    let polls = 0;
    while (now() - t0 < capMs) {
      const inv = invalidate(pathB);
      if (!xattrProbe) xattrProbe = inv;
      polls++;
      if (readOr(pathB) === payload) {
        seenAt = now();
        break;
      }
      await sleep(250);
    }
    out.push({
      round,
      wrote: payload,
      visibleOnBAfterMs: seenAt ? seenAt - t0 : null,
      timedOut: seenAt === null,
      polls,
    });
    log(`invalidate round ${round}: visible after ${out[out.length - 1].visibleOnBAfterMs} ms`);
    await sleep(1000);
  }
  return { xattrSupported: xattrProbe, rounds: out };
}

/**
 * CELL 4 - two concurrent writers using the temp-plus-rename idiom, one per mount.
 * A reader on mount A and a direct-S3 reader both poll for a torn, empty, or missing file.
 */
async function cellConcurrentRename(iters = 20) {
  const target = "auth-rename.json";
  const keyT = `${PREFIX}/${target}`;
  const observations = { mountReads: [], storeReads: [], badMount: [], badStore: [] };
  let stop = false;

  const writer = async (mnt, who) => {
    const wrote = [];
    for (let i = 1; i <= iters; i++) {
      const payload = JSON.stringify({ who, seq: i, at: now() });
      const tmp = join(mnt, `${target}.tmp.${who}`);
      rewrite(tmp, payload);
      try {
        renameSync(tmp, join(mnt, target));
        wrote.push({ seq: i, ok: true });
      } catch (err) {
        wrote.push({ seq: i, ok: false, error: err.code || String(err) });
      }
      await sleep(150);
    }
    return wrote;
  };

  const mountReader = async () => {
    while (!stop) {
      const v = readOr(join(MNT_A, target));
      observations.mountReads.push(1);
      const bad =
        typeof v !== "string" ? { kind: "error", v } : v.length === 0 ? { kind: "empty" } : null;
      let parsed = null;
      if (typeof v === "string" && v.length) {
        try {
          parsed = JSON.parse(v);
        } catch {
          observations.badMount.push({ at: now(), kind: "unparseable", v: v.slice(0, 120) });
        }
      }
      if (bad) observations.badMount.push({ at: now(), ...bad });
      void parsed;
      await sleep(60);
    }
  };

  const storeReader = async () => {
    while (!stop) {
      const g = await s3Get(keyT);
      observations.storeReads.push(1);
      if (g.status === 404) {
        observations.badStore.push({ at: now(), kind: "missing" });
      } else if (g.status === 200) {
        if (g.body.length === 0) observations.badStore.push({ at: now(), kind: "empty" });
        else {
          try {
            JSON.parse(g.body);
          } catch {
            observations.badStore.push({
              at: now(),
              kind: "unparseable",
              v: g.body.slice(0, 120),
            });
          }
        }
      }
      await sleep(50);
    }
  };

  const readers = [mountReader(), storeReader()];
  const wrote = await Promise.all([writer(MNT_A, "A"), writer(MNT_B, "B")]);
  await sleep(3000);
  stop = true;
  await Promise.all(readers);

  const listed = await s3List(`${PREFIX}/${target}`);
  const finalStore = await s3Get(keyT);
  return {
    iters,
    writerA: wrote[0].filter((w) => !w.ok).length,
    writerB: wrote[1].filter((w) => !w.ok).length,
    mountReadCount: observations.mountReads.length,
    storeReadCount: observations.storeReads.length,
    badMountReads: observations.badMount,
    badStoreReads: observations.badStore,
    finalOnA: readOr(join(MNT_A, target)),
    finalOnB: readOr(join(MNT_B, target)),
    finalInStore: { status: finalStore.status, body: finalStore.body },
    keysLeftBehind: listed.keys,
  };
}

/**
 * CELL 5 - two concurrent writers rewriting the SAME file in place (no rename), one per mount.
 * This is what a harness does when it refreshes a token. Counts lost updates.
 */
async function cellConcurrentInPlace(iters = 20) {
  const target = "auth-inplace.json";
  const key = `${PREFIX}/${target}`;
  const seenInStore = new Set();
  let stop = false;

  const writer = async (mnt, who) => {
    for (let i = 1; i <= iters; i++) {
      rewrite(join(mnt, target), JSON.stringify({ who, seq: i, at: now() }));
      await sleep(150);
    }
  };
  const storeReader = async () => {
    const bad = [];
    while (!stop) {
      const g = await s3Get(key);
      if (g.status === 200) {
        if (g.body.length === 0) bad.push({ at: now(), kind: "empty" });
        else {
          try {
            const o = JSON.parse(g.body);
            seenInStore.add(`${o.who}:${o.seq}`);
          } catch {
            bad.push({ at: now(), kind: "unparseable", v: g.body.slice(0, 120) });
          }
        }
      } else if (g.status === 404) bad.push({ at: now(), kind: "missing" });
      await sleep(50);
    }
    return bad;
  };

  const readerP = storeReader();
  await Promise.all([writer(MNT_A, "A"), writer(MNT_B, "B")]);
  await sleep(3000);
  stop = true;
  const bad = await readerP;

  const finalStore = await s3Get(key);
  const fromA = [...seenInStore].filter((s) => s.startsWith("A:")).length;
  const fromB = [...seenInStore].filter((s) => s.startsWith("B:")).length;
  return {
    iters,
    writesPerWriter: iters,
    distinctVersionsObservedInStore: seenInStore.size,
    observedFromA: fromA,
    observedFromB: fromB,
    badStoreReads: bad,
    finalOnA: readOr(join(MNT_A, target)),
    finalOnB: readOr(join(MNT_B, target)),
    finalInStore: { status: finalStore.status, body: finalStore.body },
  };
}

/**
 * CELL 6 - flock across two mounts of the same prefix. If both processes hold an exclusive lock
 * at the same time, the lock is kernel-local per mount and gives no cross-mount mutual exclusion.
 */
async function cellFlock() {
  const name = "auth-lock.json";
  rewrite(join(MNT_A, name), "{}");
  await sleep(1500);
  const py = `
import fcntl, sys, time, json
p = sys.argv[1]
f = open(p, "r+")
t0 = time.time()
try:
    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    got = True
except OSError as e:
    got = False
print(json.dumps({"path": p, "acquired": got}))
sys.stdout.flush()
time.sleep(4)
`;
  const runner = (path) =>
    new Promise((resolve) => {
      const c = spawn("python3", ["-c", py, path], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      c.on("exit", () => resolve(out.trim()));
    });
  const a = runner(join(MNT_A, name));
  await sleep(800); // let A take its lock first
  const b = runner(join(MNT_B, name));
  const [ra, rb] = await Promise.all([a, b]);
  let pa = null;
  let pb = null;
  try {
    pa = JSON.parse(ra);
  } catch {
    pa = { raw: ra };
  }
  try {
    pb = JSON.parse(rb);
  } catch {
    pb = { raw: rb };
  }
  return {
    mountA: pa,
    mountB: pb,
    bothHeldAtOnce: !!(pa && pa.acquired && pb && pb.acquired),
  };
}

/**
 * CELL 7 - conditional PUT (compare and swap) straight against the S3 gateway, bypassing the
 * mount. This is the cheap lock-free alternative to a shared mount.
 */
async function cellConditionalPut() {
  const key = `${PREFIX}/cas-probe.json`;
  await s3Delete(key);
  const first = await s3Put(key, JSON.stringify({ v: 1 }), { "if-none-match": "*" });
  const second = await s3Put(key, JSON.stringify({ v: 2 }), { "if-none-match": "*" });
  const head = await s3Get(key);
  const etag = head.etag;
  const matchOk = await s3Put(key, JSON.stringify({ v: 3 }), { "if-match": etag ?? '"x"' });
  const matchStale = await s3Put(key, JSON.stringify({ v: 4 }), {
    "if-match": '"00000000000000000000000000000000"',
  });
  const final = await s3Get(key);
  const unconditional = await s3Put(key, JSON.stringify({ v: 5 }));
  const afterUnconditional = await s3Get(key);
  return {
    ifNoneMatchOnAbsentKey: first.status,
    ifNoneMatchOnExistingKey: second.status,
    etagAfterCreate: etag,
    ifMatchCorrectEtag: matchOk.status,
    ifMatchStaleEtag: matchStale.status,
    bodyAfterConditionalWrites: final.body,
    unconditionalPut: unconditional.status,
    bodyAfterUnconditionalPut: afterUnconditional.body,
  };
}

/** CELL 8 - what a symlink written on the mount looks like to the store and to the other mount. */
async function cellSymlink() {
  const linkName = "auth-symlink.json";
  const targetName = "real-auth.json";
  rewrite(join(MNT_A, targetName), JSON.stringify({ real: true }));
  try {
    rmSync(join(MNT_A, linkName), { force: true });
  } catch {
    /* nothing there */
  }
  let created = true;
  let createError = null;
  try {
    execFileSync("ln", ["-s", targetName, join(MNT_A, linkName)]);
  } catch (err) {
    created = false;
    createError = String(err.stderr || err).slice(0, 200);
  }
  await sleep(3000);
  const onA = (() => {
    try {
      return execFileSync("ls", ["-la", join(MNT_A, linkName)]).toString().trim();
    } catch (err) {
      return String(err.stderr || err).slice(0, 200);
    }
  })();
  // A fresh third mount is the honest test of what a NEW sandbox sees after a round trip.
  const MNT_C = join(ROOT, "c");
  await mount(MNT_C, join(ROOT, "geesefs-c.log"));
  const onC = (() => {
    try {
      return execFileSync("ls", ["-la", join(MNT_C, linkName)]).toString().trim();
    } catch (err) {
      return String(err.stderr || err).slice(0, 200);
    }
  })();
  const readThroughC = readOr(join(MNT_C, linkName));
  const store = await s3Get(`${PREFIX}/${linkName}`);
  return {
    created,
    createError,
    lsOnWritingMount: onA,
    lsOnFreshMount: onC,
    readThroughFreshMount: readThroughC,
    storeStatus: store.status,
    storeBodyLength: store.body.length,
    storeContentLength: store.contentLength,
  };
}

// ---------------------------------------------------------------------- main --

async function main() {
  mkdirSync(ROOT, { recursive: true });
  try {
    results.meta.geesefsVersion = execFileSync("geesefs", ["--version"]).toString().trim();
  } catch {
    /* optional */
  }
  log(`prefix ${BUCKET}:${PREFIX}`);
  // Mounts A and B always come up, so any single cell can be run alone through EXP_CELLS.
  await mount(MNT_A, LOG_A);
  await mount(MNT_B, LOG_B);

  // EXP_CELLS is a comma-separated allowlist of cell keys; empty means run every cell.
  const only = (process.env.EXP_CELLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const run = async (key, fn) => {
    if (only.length && !only.includes(key)) {
      log(`--- cell ${key} skipped (EXP_CELLS) ---`);
      return;
    }
    log(`--- cell ${key} ---`);
    try {
      results.cells[key] = await fn();
    } catch (err) {
      results.cells[key] = { error: String(err && err.stack ? err.stack : err).slice(0, 800) };
      log(`cell ${key} FAILED: ${err}`);
    }
    writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  };

  await run("1_cold_read", cellColdRead);
  await run("2_warm_staleness", () => cellWarmStaleness(2));
  await run("3_invalidate_xattr", () => cellInvalidate(2));
  await run("4_concurrent_rename", () => cellConcurrentRename(20));
  await run("5_concurrent_in_place", () => cellConcurrentInPlace(20));
  await run("6_flock_across_mounts", cellFlock);
  await run("7_conditional_put", cellConditionalPut);
  await run("8_symlink_round_trip", cellSymlink);

  results.meta.finishedAt = new Date().toISOString();
  writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  log(`results written to ${OUT_JSON}`);
}

process.on("exit", cleanupMounts);
process.on("SIGINT", () => {
  cleanupMounts();
  process.exit(130);
});

main()
  .then(() => {
    cleanupMounts();
    process.exit(0);
  })
  .catch((err) => {
    log(`FATAL ${err && err.stack ? err.stack : err}`);
    cleanupMounts();
    process.exit(1);
  });
