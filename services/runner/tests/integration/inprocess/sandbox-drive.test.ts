/**
 * Round 7 (2c) against a real object store and a real geesefs mount: the command sandbox's view of
 * the drive, and the runner's direct writes to it.
 *
 * - A `write` through the sandbox helper is in the store when the call returns (the helper
 *   `fsync`s; geesefs only starts the upload on close).
 * - A files-pane change straight to the store (a shrink, a new file, a delete) shows in the
 *   sandbox's view after the turn-start refresh, and reading the shrunk file does not hang.
 * - A command's changes are in the store after the supervisor's `sync -f`.
 * - Pi's conversation file and the skill snapshot go to the store through `DriveObjects`.
 *
 * (`--enable-perms` keeping a skill's executable bit across mounts was checked on real Daytona in
 * round 7, see the spike's findings: the throwaway store here does not keep the mode.)
 *
 * The "sandbox" is this machine: its view is a geesefs mount made with the runner's own code and
 * the command sandbox's flags. Runs when `AGENTA_TEST_S3_ENDPOINT` (an S3 endpoint where this test
 * may create a bucket) and geesefs with FUSE are available; `spike/sandbox-drive-test.sh` runs it
 * in a container of the runner image against a throwaway SeaweedFS.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput, DaytonaSandbox, RunOptions } from "../../../src/engines/inprocess/sandbox/daytona-api.ts";
import { readFile, writeFile } from "../../../src/engines/inprocess/sandbox/sandbox-files.ts";
import { DriveObjects } from "../../../src/engines/inprocess/workspace/drive-objects.ts";
import { TranscriptStore } from "../../../src/engines/inprocess/workspace/transcript-store.ts";
import { BOUNDED_READ_RETRY_ATTEMPTS, mountStorage, unmountStorage, type MountCredentials } from "../../../src/engines/sandbox_agent/mount.ts";
import { REFRESH_ROOTS_SCRIPT } from "../../../src/engines/sandbox_agent/turn-start-refresh.ts";

const endpoint = process.env.AGENTA_TEST_S3_ENDPOINT;
const hasGeesefs = (() => {
  try {
    execFileSync("geesefs", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** This machine as the command sandbox: `run` is bash here. */
const here: DaytonaSandbox = {
  id: "local",
  state: "started",
  labels: {},
  refresh: async () => {},
  start: async () => {},
  stop: async () => {},
  remove: async () => {},
  updateNetwork: async () => {},
  run: (command: string, options: RunOptions) =>
    new Promise<CommandOutput>((resolve) => {
      const child = spawn("bash", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (d) => (output += String(d)));
      child.stderr.on("data", (d) => (output += String(d)));
      const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutSeconds * 1000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? -1, output });
      });
    }),
  upload: async () => {
    throw new Error("not used");
  },
  download: async () => {
    throw new Error("not used");
  },
};

describe.skipIf(!endpoint || !hasGeesefs)("the command sandbox's view of the drive, against a real store", () => {
  const bucket = `sandbox-drive-${randomUUID().slice(0, 8)}`;
  const creds = (prefix: string): MountCredentials => ({
    endpoint: endpoint!,
    region: "us-east-1",
    bucket,
    prefix,
    accessKey: process.env.AGENTA_TEST_S3_ACCESS_KEY ?? "testkey",
    secretKey: process.env.AGENTA_TEST_S3_SECRET_KEY ?? "testsecret",
  });
  const session = creds("project/conversation");
  const s3 = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: session.accessKey, secretAccessKey: session.secretKey } });
  const base = mkdtempSync(join(tmpdir(), "sandbox-drive-"));
  const view = join(base, "view");
  const log = () => {};
  const sh = (command: string) => here.run(command, { timeoutSeconds: 60 });
  const key = (rel: string) => `${session.prefix}/${rel}`;
  const stored = async (rel: string) => {
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key(rel) }));
      return Buffer.from(await r.Body!.transformToByteArray()).toString("utf-8");
    } catch {
      return undefined;
    }
  };
  const size = (path: string) => {
    try {
      return statSync(path).size;
    } catch {
      return -1;
    }
  };

  beforeAll(async () => {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    mkdirSync(view, { recursive: true });
    expect(await mountStorage(view, session, { log, geesefs: { enablePerms: true, readRetryAttempts: BOUNDED_READ_RETRY_ATTEMPTS } })).toBe(true);
  }, 60_000);

  afterAll(async () => {
    await unmountStorage(view, { log });
  });

  it("puts every write in the store before the call returns: new files, new folders, overwrites of any size, 30 times", async () => {
    let wrong = 0;
    for (let i = 0; i < 30; i++) {
      const rel = i % 3 === 0 ? `w/new-${i}/f.txt` : i % 3 === 1 ? "w/same-size.txt" : "w/shrinks.txt";
      const content = i % 3 === 1 ? `same-${String(i).padStart(3, "0")}\n` : i % 3 === 2 ? "x".repeat(300 - i * 5) : `content ${i}\n`;
      await writeFile(here, join(view, rel), Buffer.from(content), { tmpDir: "/tmp" });
      if ((await stored(rel)) !== content) wrong += 1;
    }
    expect(wrong).toBe(0);
    // The write goes through a temporary file renamed over the target: none is left in the store.
    const keys = (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: key("w/") }))).Contents?.map((o) => o.Key!) ?? [];
    expect(keys.filter((k) => k.includes(".agenta-"))).toEqual([]);
  }, 120_000);

  it("shows a files-pane change (a shrink, a new file, a delete) after the turn-start refresh, and reads the shrunk file without hanging", async () => {
    await writeFile(here, join(view, "pane", "doc.md"), Buffer.from("a long first version of the document\n"), { tmpDir: "/tmp" });
    await writeFile(here, join(view, "pane", "old.md"), Buffer.from("to be deleted\n"), { tmpDir: "/tmp" });
    for (const n of ["doc", "old", "new"]) size(join(view, "pane", `${n}.md`));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key("pane/doc.md"), Body: "short\n" }));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key("pane/new.md"), Body: "uploaded\n" }));
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key("pane/old.md") }));
    execFileSync("python3", ["-c", REFRESH_ROOTS_SCRIPT, view]);
    const t0 = Date.now();
    expect((await readFile(here, join(view, "pane", "doc.md"), 1 << 20)).toString()).toBe("short\n");
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect((await readFile(here, join(view, "pane", "new.md"), 1 << 20)).toString()).toBe("uploaded\n");
    expect(size(join(view, "pane", "old.md"))).toBe(-1);
  }, 60_000);

  it("has a command's changes, renames and deletes in the store after the supervisor's flush", async () => {
    await sh(`mkdir -p ${view}/cmd/gone && echo a > ${view}/cmd/mod.txt && echo b > ${view}/cmd/ren.txt && echo c > ${view}/cmd/del.txt && echo g > ${view}/cmd/gone/g.txt && sync -f ${view}`);
    await sh(`cd ${view}/cmd && echo more >> mod.txt && mv ren.txt renamed.txt && rm del.txt && rm -r gone && mkdir -p new && echo n > new/n.txt; sync -f ${view}`);
    const listed = (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: key("cmd/") }))).Contents?.map((o) => o.Key!.slice(key("cmd/").length)).filter((k) => k && !k.endsWith("/")) ?? [];
    expect(listed.sort()).toEqual(["mod.txt", "new/n.txt", "renamed.txt"].sort());
    expect(await stored("cmd/mod.txt")).toBe("a\nmore\n");
  }, 60_000);

  it("keeps Pi's conversation file in its own prefix, and brings it back on another runner", async () => {
    const transcripts = creds("project/pi-sessions");
    const local = join(base, "pi-1");
    const store = new TranscriptStore(local, new DriveObjects(() => transcripts), log);
    await store.restore();
    writeFileSync(join(local, "2026_abc.jsonl"), '{"id":"abc"}\n{"turn":1}\n');
    await store.save();
    const again = join(base, "pi-2");
    await new TranscriptStore(again, new DriveObjects(() => transcripts), log).restore();
    expect(readFileSync(join(again, "2026_abc.jsonl"), "utf-8")).toContain('"turn":1');
    // Never in the session folder the sandbox mounts.
    expect(await stored("agents/sessions/pi/2026_abc.jsonl")).toBeUndefined();
    rmSync(local, { recursive: true, force: true });
  }, 60_000);
});
