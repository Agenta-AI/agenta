/**
 * Pi's conversation file on the runner's disk and in its drive prefix: the store holds the durable
 * copy (Codex round 7 P2: a longer local file is not proof of a newer one).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sweepTranscriptDirs, transcriptDir, TranscriptStore } from "../../../src/engines/inprocess/workspace/transcript-store.ts";
import { createTestWorkspace } from "../../utils/inprocess-workspace.ts";
import { memoryObjects, TEST_CREDENTIALS, TEST_TRANSCRIPT_CREDENTIALS } from "../../utils/local-drive.ts";

describe("restoring Pi's conversation file", () => {
  it("takes the store's copy over a local file this process did not save, even a longer one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "transcripts-"));
    const store = memoryObjects()(() => TEST_TRANSCRIPT_CREDENTIALS);
    await store.put("s1.jsonl", Buffer.from('{"turn":1}\n'));
    // A turn a failed save left only on this disk before a restart.
    writeFileSync(join(dir, "s1.jsonl"), '{"turn":1}\n{"turn":2,"unsaved":true}\n');
    await new TranscriptStore(dir, store, () => {}).restore();
    expect(readFileSync(join(dir, "s1.jsonl"), "utf-8")).toBe('{"turn":1}\n');
  });

  it("keeps the local file this process saved last", async () => {
    const dir = mkdtempSync(join(tmpdir(), "transcripts-"));
    const store = memoryObjects()(() => TEST_TRANSCRIPT_CREDENTIALS);
    const transcripts = new TranscriptStore(dir, store, () => {});
    writeFileSync(join(dir, "s1.jsonl"), '{"turn":1}\n');
    await transcripts.save();
    let gets = 0;
    const get = store.get.bind(store);
    store.get = async (rel) => {
      gets += 1;
      return get(rel);
    };
    await transcripts.restore();
    expect(gets).toBe(0);
    expect(readFileSync(join(dir, "s1.jsonl"), "utf-8")).toBe('{"turn":1}\n');
  });

  it("removes a local file the store never got and this process did not save (a failed first save before a restart; Codex round 8)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "transcripts-"));
    const store = memoryObjects()(() => TEST_TRANSCRIPT_CREDENTIALS);
    writeFileSync(join(dir, "s2.jsonl"), '{"turn":1,"unsaved":true}\n');
    writeFileSync(join(dir, "notes.txt"), "not a transcript\n");
    await new TranscriptStore(dir, store, () => {}).restore();
    expect(existsSync(join(dir, "s2.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
  });
});

describe("the runner-local copy's lifetime", () => {
  it("dispose removes the instance folder, and its empty parent, after a pending save has landed", async () => {
    const parent = transcriptDir(join(mkdtempSync(join(tmpdir(), "transcripts-")), "cwd"));
    const dir = join(parent, "instance-1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s1.jsonl"), '{"turn":1}\n');
    const store = memoryObjects()(() => TEST_TRANSCRIPT_CREDENTIALS);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const put = store.put.bind(store);
    store.put = async (rel, body) => {
      await gate;
      return put(rel, body);
    };
    const transcripts = new TranscriptStore(dir, store, () => {});
    const saving = transcripts.save();
    const disposing = transcripts.dispose();
    release();
    await Promise.all([saving, disposing]);
    expect((await store.get("s1.jsonl"))?.toString()).toBe('{"turn":1}\n');
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(parent)).toBe(false);
  });

  it("a replacement workspace for the same conversation restores into its own folder and outlives the old one's dispose", async () => {
    const t = createTestWorkspace();
    const old = t.workspace;
    await old.transcripts.restore();
    t.registry.release(old, "delete");
    const replacement = t.registry.hold({
      key: "inprocess:project:conv-1",
      conversationId: "conv-1",
      projectId: "project",
      cwd: t.cwd,
      drive: [{ root: t.cwd, credentials: () => TEST_CREDENTIALS }],
      skillModes: new Map(),
      signTranscriptMount: async () => TEST_TRANSCRIPT_CREDENTIALS,
    });
    expect(replacement).not.toBe(old);
    expect(replacement.transcripts.dir).not.toBe(old.transcripts.dir);
    expect(replacement.transcripts.dir.startsWith(`${transcriptDir(t.cwd)}/`)).toBe(true);
    await replacement.transcripts.restore();
    await t.registry.settle(5_000);
    expect(existsSync(old.transcripts.dir)).toBe(false);
    expect(existsSync(replacement.transcripts.dir)).toBe(true);
  });

  it("the startup sweep removes every leftover folder under the mounts root, and nothing else", async () => {
    const root = mkdtempSync(join(tmpdir(), "mounts-"));
    mkdirSync(join(root, "p1", "m1-pi-sessions", "i1"), { recursive: true });
    writeFileSync(join(root, "p1", "m1-pi-sessions", "i1", "s.jsonl"), "{}\n");
    mkdirSync(join(root, "p1", "m1"), { recursive: true });
    mkdirSync(join(root, "p2", "m2-pi-sessions"), { recursive: true });
    const logs: string[] = [];
    expect(await sweepTranscriptDirs(root, (m) => logs.push(m))).toBe(2);
    expect(existsSync(join(root, "p1", "m1-pi-sessions"))).toBe(false);
    expect(existsSync(join(root, "p2", "m2-pi-sessions"))).toBe(false);
    expect(existsSync(join(root, "p1", "m1"))).toBe(true);
    expect(await sweepTranscriptDirs(join(root, "missing"), () => {})).toBe(0);
  });
});
