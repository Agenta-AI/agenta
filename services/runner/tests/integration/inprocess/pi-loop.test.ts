/**
 * Whole turns through the real Pi agent loop, in process, against a scripted model server and the
 * local Daytona stand-in. The unit tests pin each piece; these pin the pieces together: an
 * approval pause, Stop in the middle of a command, the silence watchdog, and a runner restart
 * between two turns of one conversation.
 */
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySessionPersistDriver } from "sandbox-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TurnSilenceError } from "../../../src/engines/inprocess/pi/turn-watchdog.ts";
import { capture, createHostFixture } from "../../utils/inprocess-host.ts";
import { startScriptedModel, type ScriptedModel } from "../../utils/scripted-model.ts";
import { TEST_CREDENTIALS, TEST_TRANSCRIPT_CREDENTIALS } from "../../utils/local-drive.ts";
import { PI_SKILL_SNAPSHOT_MARKER } from "../../../src/engines/sandbox_agent/pi-assets.ts";

let model: ScriptedModel;

beforeAll(async () => {
  model = await startScriptedModel();
});

afterAll(async () => {
  await model.close();
});

const prompt = (text: string) => [{ type: "text", text }];

async function openSession(fixture: ReturnType<typeof createHostFixture>, options: Parameters<ReturnType<ReturnType<typeof createHostFixture>["runner"]>["host"]>[0] = {}, runnerOptions = {}) {
  const runner = fixture.runner(runnerOptions);
  const { host, persist } = runner.host(options);
  const session = await host.createSession({ agent: "pi", cwd: fixture.cwd, sessionInit: { cwd: fixture.cwd, mcpServers: [] } });
  await session.setModel("mock/mock-1");
  return { runner, host, persist, session, turn: capture(session) };
}

describe("a conversation that runs no command (QA4A-1)", () => {
  it("never creates, starts or even asks for a sandbox: not on session open, not on a chat turn, not on a denied approval", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ text: "just talking" }]);
    const { host, session, turn } = await openSession(fixture, { gating: true });
    expect(await session.prompt(prompt("hello"))).toEqual({ stopReason: "end_turn" });
    expect(turn.text()).toContain("just talking");
    model.script([{ tool: "bash", args: { command: "echo never" } }, { text: "fine, not running it" }]);
    const denied = session.prompt(prompt("run something"));
    while (turn.permissions.length === 0) await new Promise((r) => setTimeout(r, 20));
    await session.respondPermission(turn.permissions[0]!.id, "reject");
    await denied;
    await host.pauseSandbox();
    expect(fixture.daytona.creates).toBe(0);
    expect(fixture.daytona.createRequests).toHaveLength(0);
    expect(fixture.daytona.sandboxes.size).toBe(0);
  }, 30_000);
});

describe("admission and accounting (decision 8)", () => {
  it("refuses a session past the runner's maximum, and counts a session's transcript after a turn", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ text: "counted" }]);
    const runner = fixture.runner({ config: { maxSessions: 1 } });
    const { host } = runner.host();
    const session = await host.createSession({ agent: "pi", cwd: fixture.cwd, sessionInit: { cwd: fixture.cwd, mcpServers: [] } });
    await session.setModel("mock/mock-1");
    await session.prompt(prompt("hello"));
    await expect(runner.host().host.createSession({ agent: "pi", cwd: fixture.cwd, sessionInit: { cwd: fixture.cwd, mcpServers: [] } })).rejects.toMatchObject({
      publicCode: "runner_capacity",
    });
    expect(runner.ledger.footprint(session.id)!.transcriptBytes).toBeGreaterThan(0);
    await host.destroySession(session.id);
    expect(runner.ledger.footprint(session.id)).toBeUndefined();
  }, 30_000);

  it("never lets sessions opening at the same time pass the cap together (Codex R5 P1-3)", async () => {
    const fixture = createHostFixture(model.baseUrl);
    const runner = fixture.runner({ config: { maxSessions: 1 } });
    const open = () => runner.host().host.createSession({ agent: "pi", cwd: fixture.cwd, sessionInit: { cwd: fixture.cwd, mcpServers: [] } });
    const results = await Promise.allSettled([open(), open(), open()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.publicCode)).toEqual(["runner_capacity", "runner_capacity"]);
    expect(runner.ledger.snapshot().sessions).toBe(1);
  }, 30_000);
});

describe("an approval pause", () => {
  it("asks before the command runs, waits past the idle limit, and runs it once approved", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ tool: "bash", args: { command: "echo approved-run > approved.txt; echo done" } }, { text: "all finished" }]);
    const { session, turn } = await openSession(fixture, { gating: true }, { config: { turnIdleTimeoutMs: 300, turnModelSilenceTimeoutMs: 300 } });
    const result = session.prompt(prompt("run it"));
    while (turn.permissions.length === 0) await new Promise((r) => setTimeout(r, 20));
    // Nothing ran yet, and the watchdog does not count the wait for a person as silence.
    await new Promise((r) => setTimeout(r, 800));
    expect(fixture.daytona.sandboxes.size).toBe(0);
    await session.respondPermission(turn.permissions[0]!.id, "once");
    expect(await result).toEqual({ stopReason: "end_turn" });
    expect(readFileSync(join(fixture.cwd, "approved.txt"), "utf-8")).toBe("approved-run\n");
    expect(turn.text()).toContain("all finished");
    const toolCall = turn.events.find((e) => e.sessionUpdate === "tool_call");
    expect(toolCall).toMatchObject({ title: "bash", kind: "other" });
  }, 30_000);
});

describe("Stop in the middle of a command", () => {
  it("ends the turn as cancelled within seconds and leaves nothing running", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ tool: "bash", args: { command: "sleep 30; echo never" } }, { text: "should not be reached" }]);
    const { host, session } = await openSession(fixture);
    const result = session.prompt(prompt("sleep"));
    while ([...fixture.daytona.sandboxes.values()].every((s) => !s.commands.some((c) => c.includes("setsid")))) await new Promise((r) => setTimeout(r, 20));
    const t0 = Date.now();
    await host.cancelSession(session.id);
    expect(await result).toEqual({ stopReason: "cancelled" });
    expect(Date.now() - t0).toBeLessThan(6_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(execSync("pgrep -f 'sleep 3[0]; echo never' || true").toString().trim()).toBe("");
  }, 30_000);

  it("lets a message sent right after Stop run as its own turn, not queue behind the stopped one (R3-15)", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ tool: "bash", args: { command: "sleep 30; echo never" } }, { text: "should not be reached" }]);
    const { host, session, turn } = await openSession(fixture);
    const stopped = session.prompt(prompt("sleep"));
    while ([...fixture.daytona.sandboxes.values()].every((s) => !s.commands.some((c) => c.includes("setsid")))) await new Promise((r) => setTimeout(r, 20));
    await host.cancelSession(session.id);
    model.script([{ text: "fresh answer" }]);
    const next = session.prompt(prompt("next"));
    expect(await stopped).toEqual({ stopReason: "cancelled" });
    expect(await next).toEqual({ stopReason: "end_turn" });
    expect(turn.text()).toContain("fresh answer");
    expect(turn.text()).not.toMatch(/Queued message/);
  }, 30_000);
});

describe("the silence watchdog", () => {
  it("ends a turn whose model request never answers", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ silence: true }]);
    const { session } = await openSession(fixture, {}, { config: { turnIdleTimeoutMs: 300, turnModelSilenceTimeoutMs: 600 } });
    const t0 = Date.now();
    await expect(session.prompt(prompt("hello"))).rejects.toBeInstanceOf(TurnSilenceError);
    expect(Date.now() - t0).toBeLessThan(3_000);
  }, 30_000);

  it("does not end a slow reasoning model that keeps streaming thoughts", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ think: { everyMs: 150, forMs: 1_500 }, text: "thought it through" }]);
    const { session, turn } = await openSession(fixture, {}, { config: { turnIdleTimeoutMs: 400, turnModelSilenceTimeoutMs: 400 } });
    expect(await session.prompt(prompt("think"))).toEqual({ stopReason: "end_turn" });
    expect(turn.text()).toContain("thought it through");
  }, 30_000);
});

describe("every tool in the command sandbox (round 7)", () => {
  it("writes, reads and edits through the command sandbox in one turn, and keeps the conversation file out of the session folder", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([
      { tool: "write", args: { path: "plan.md", content: "step one\n" } },
      { tool: "read", args: { path: "plan.md" } },
      { tool: "edit", args: { path: "plan.md", edits: [{ oldText: "one", newText: "two" }] } },
      { tool: "read", args: { path: "plan.md" } },
      { text: "planned" },
    ]);
    const { host, session, turn } = await openSession(fixture);
    expect(await session.prompt(prompt("plan"))).toEqual({ stopReason: "end_turn" });
    const reads = turn.events.filter((e) => e.sessionUpdate === "tool_call_update" && e.status === "completed").map((e) => JSON.stringify(e));
    expect(reads.some((r) => r.includes("step one"))).toBe(true);
    expect(reads.some((r) => r.includes("step two"))).toBe(true);
    expect(readFileSync(join(fixture.cwd, "plan.md"), "utf-8")).toBe("step two\n");
    expect(fixture.daytona.creates).toBe(1);
    // Pi's conversation file: on the runner's disk and in its own drive prefix, never in the session folder the sandbox mounts.
    // The save runs after the turn ended, off its path.
    await vi.waitFor(() => expect(fixture.objects.get(TEST_TRANSCRIPT_CREDENTIALS.prefix)?.size).toBe(1));
    const saved = [...(fixture.objects.get(TEST_TRANSCRIPT_CREDENTIALS.prefix) ?? new Map())];
    expect(saved).toHaveLength(1);
    expect(saved[0]![1].toString("utf-8")).toContain("step two");
    const instances = readdirSync(fixture.transcripts);
    expect(instances).toHaveLength(1);
    expect(readdirSync(join(fixture.transcripts, instances[0]!)).filter((n) => n.endsWith(".jsonl"))).toEqual([saved[0]![0]]);
    expect(existsSync(join(fixture.cwd, "agents", "sessions", "pi")) && readdirSync(join(fixture.cwd, "agents", "sessions", "pi")).length > 0).toBe(false);
    await host.destroySandbox();
  }, 30_000);

  it("runs a skill script in the sandbox, with the executable bit the drive does not keep", async () => {
    const source = mkdtempSync(join(tmpdir(), "skill-src-"));
    mkdirSync(join(source, "scripts"), { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: check\ndescription: runs a check\n---\nRun scripts/check.sh.\n");
    writeFileSync(join(source, "scripts", "check.sh"), "#!/bin/sh\necho skill-ran\n");
    chmodSync(join(source, "scripts", "check.sh"), 0o755);
    const fixture = createHostFixture(model.baseUrl, { skills: [{ name: "check", dir: source }], skillSnapshot: "agents/skills/digest" });
    const snapshot = join(fixture.cwd, "agents", "skills", "digest");
    // The snapshot as the drive holds it: the content, with every mode dropped to 644.
    mkdirSync(join(snapshot, "check", "scripts"), { recursive: true });
    writeFileSync(join(snapshot, "check", "SKILL.md"), readFileSync(join(source, "SKILL.md")));
    writeFileSync(join(snapshot, "check", "scripts", "check.sh"), readFileSync(join(source, "scripts", "check.sh")), { mode: 0o644 });
    writeFileSync(join(snapshot, PI_SKILL_SNAPSHOT_MARKER), "digest-marker");
    model.script([{ tool: "bash", args: { command: "agents/skills/digest/check/scripts/check.sh" } }, { text: "checked" }]);
    const { host, session, turn } = await openSession(fixture);
    expect(await session.prompt(prompt("check"))).toEqual({ stopReason: "end_turn" });
    const result = JSON.stringify(turn.events.find((e) => e.sessionUpdate === "tool_call_update" && e.status === "completed"));
    expect(result).toContain("skill-ran");
    // The runner put its snapshot on the drive itself (it mounts nothing), marker last.
    const drive = fixture.objects.get(TEST_CREDENTIALS.prefix)!;
    expect(drive.get("agents/skills/digest/check/SKILL.md")?.toString()).toContain("name: check");
    expect(drive.get(`agents/skills/digest/${PI_SKILL_SNAPSHOT_MARKER}`)?.toString()).toBe("digest-marker");
    await host.destroySandbox();
  }, 30_000);
});

describe("a runner restart between two turns", () => {
  it("resumes the history on a fresh sandbox that mounts the drive; the old sandbox is never used again", async () => {
    const fixture = createHostFixture(model.baseUrl);
    // The sandbox's own disk outside the drive (the stand-in's $HOME is its sandbox folder).
    const marker = "$HOME/agenta-restart-marker";
    model.script([{ tool: "bash", args: { command: `echo kept > ${marker}; echo first > first.txt` } }, { text: "first turn done" }]);
    const first = await openSession(fixture);
    expect(await first.session.prompt(prompt("turn one"))).toEqual({ stopReason: "end_turn" });
    const record = await first.persist.getSession(first.session.id);
    const oldId = first.host.sandboxId!;
    await first.host.pauseSandbox();
    await first.runner.registry.settle(5_000);
    const old = fixture.daytona.sandboxes.get(oldId)!;
    expect(old.state).toBe("stopped");
    const oldCalls = old.calls.length;

    // A new runner process: new owner, new registry, new host; only the durable record and the drive survive.
    const persist = new InMemorySessionPersistDriver();
    await persist.updateSession(record!);
    const second = fixture.runner({ owner: "runner-a-restarted" }).host({ persist });
    const resumed = await second.host.resumeSession(first.session.id);
    const turn = capture(resumed);
    await resumed.setModel("mock/mock-1");
    model.script([{ tool: "bash", args: { command: `cat first.txt; cat ${marker} 2>/dev/null || echo no-marker` } }, { text: "second turn done" }]);
    expect(await resumed.prompt(prompt("turn two"))).toEqual({ stopReason: "end_turn" });
    const toolResult = JSON.stringify(turn.events.find((e) => e.sessionUpdate === "tool_call_update" && e.status === "completed"));
    // The drive is mounted in the new sandbox; the old sandbox's own disk did not carry over.
    expect(toolResult).toContain("first");
    expect(toolResult).toContain("no-marker");
    expect(fixture.daytona.creates).toBe(2);
    expect(second.host.sandboxId).not.toBe(oldId);
    expect(old.calls.length).toBe(oldCalls);
    // The model saw the first turn's history.
    expect(JSON.stringify(model.requests.at(-1)!.messages)).toContain("turn one");
    await second.host.destroySandbox();
  }, 60_000);
});

describe("the conversation file on the drive", () => {
  it("brings the history back on a runner that lost its disk", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ text: "remember BLUE" }]);
    const first = await openSession(fixture);
    expect(await first.session.prompt(prompt("the colour is blue"))).toEqual({ stopReason: "end_turn" });
    const record = await first.persist.getSession(first.session.id);
    await first.host.destroySandbox();
    // A new runner on another machine: the local folder is gone, only the drive has the file.
    rmSync(fixture.transcripts, { recursive: true, force: true });
    const persist = new InMemorySessionPersistDriver();
    await persist.updateSession(record!);
    const second = fixture.runner({ owner: "runner-b" }).host({ persist });
    const resumed = await second.host.resumeSession(first.session.id);
    await resumed.setModel("mock/mock-1");
    model.script([{ text: "still blue" }]);
    expect(await resumed.prompt(prompt("what colour?"))).toEqual({ stopReason: "end_turn" });
    expect(JSON.stringify(model.requests.at(-1)!.messages)).toContain("the colour is blue");
    await second.host.destroySandbox();

  }, 60_000);
});

describe("a turn the provider refuses (POC session 53da670e)", () => {
  const REFUSAL = "Upstream error from Inception: I'm sorry, but I can't share details of my architecture or training process.";

  it("keeps the failed turn's question and drops what the agent did, for the next turn and a reload", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ text: "hello there" }]);
    const first = await openSession(fixture);
    expect(await first.session.prompt(prompt("hi"))).toEqual({ stopReason: "end_turn" });

    // The failing turn runs a tool first, then the provider refuses the follow-up request.
    model.script([{ tool: "read", args: { path: "missing.txt" } }, { error: { status: 400, message: REFUSAL } }]);
    await expect(first.session.prompt(prompt("check the pricing for mercury"))).rejects.toThrow(/Inception/);
    expect(await first.session.rollbackFailedTurn()).toBe(true);

    // The next turn on the same session: the completed turn and the failed turn's question go
    // out; the failed turn's tool call, its result and the refusal do not.
    model.script([{ text: "fine again" }]);
    expect(await first.session.prompt(prompt("thanks"))).toEqual({ stopReason: "end_turn" });
    const sent = JSON.stringify(model.requests.at(-1)!.messages);
    expect(sent).toContain("hi");
    expect(sent).toContain("hello there");
    expect(sent).toContain("check the pricing for mercury");
    expect(sent).toContain("thanks");
    expect(sent).not.toContain("missing.txt");
    expect(sent).not.toContain("Inception");

    // A reload (a later cold turn or a runner restart) resumes from the same place.
    const record = await first.persist.getSession(first.session.id);
    await first.host.destroySandbox();
    const persist = new InMemorySessionPersistDriver();
    await persist.updateSession(record!);
    const second = fixture.runner({ owner: "runner-a-restarted" }).host({ persist });
    const resumed = await second.host.resumeSession(first.session.id);
    await resumed.setModel("mock/mock-1");
    model.script([{ text: "still fine" }]);
    expect(await resumed.prompt(prompt("one more"))).toEqual({ stopReason: "end_turn" });
    const reloaded = JSON.stringify(model.requests.at(-1)!.messages);
    expect(reloaded).toContain("fine again");
    expect(reloaded).toContain("check the pricing for mercury");
    expect(reloaded).not.toContain("missing.txt");
    await second.host.destroySandbox();
  }, 60_000);

  it("reports a refused turn's rollback as unsaved while its conversation file is not on the drive", async () => {
    const fixture = createHostFixture(model.baseUrl);
    const transcriptPrefix = TEST_TRANSCRIPT_CREDENTIALS.prefix;
    model.script([{ text: "hello there" }]);
    const { session, host } = await openSession(fixture);
    expect(await session.prompt(prompt("hi"))).toEqual({ stopReason: "end_turn" });

    // Refused on its first request, while the store refuses every put.
    fixture.faults.beforePut = async (prefix) => {
      if (prefix === transcriptPrefix) throw new Error("store refused the put");
    };
    model.script([{ error: { status: 400, message: REFUSAL } }]);
    await expect(session.prompt(prompt("check the pricing for mercury"))).rejects.toThrow(/Inception/);
    // Not a resume point while the file that holds the question is not saved.
    expect(await session.rollbackFailedTurn()).toBe(false);
    await host.destroySandbox();
  }, 30_000);

  it("does not roll back a turn that completed", async () => {
    const fixture = createHostFixture(model.baseUrl);
    model.script([{ text: "kept" }]);
    const { session, host } = await openSession(fixture);
    expect(await session.prompt(prompt("keep me"))).toEqual({ stopReason: "end_turn" });
    expect(await session.rollbackFailedTurn()).toBe(false);
    model.script([{ text: "ok" }]);
    await session.prompt(prompt("next"));
    expect(JSON.stringify(model.requests.at(-1)!.messages)).toContain("keep me");
    await host.destroySandbox();
  }, 30_000);
});

describe("a completed turn and its conversation file (Codex R9-2)", () => {
  const transcriptPrefix = TEST_TRANSCRIPT_CREDENTIALS.prefix;
  const storedTranscript = (fixture: ReturnType<typeof createHostFixture>) =>
    [...(fixture.objects.get(transcriptPrefix)?.values() ?? [])].map((body) => body.toString()).join("\n");

  it("ends the turn only after its conversation file is on the drive", async () => {
    const fixture = createHostFixture(model.baseUrl);
    fixture.faults.beforePut = async (prefix) => {
      if (prefix === transcriptPrefix) await new Promise((r) => setTimeout(r, 300));
    };
    model.script([{ text: "saved answer" }]);
    const { session, host } = await openSession(fixture);
    expect(await session.prompt(prompt("save this turn"))).toEqual({ stopReason: "end_turn" });
    // A runner that dies right after the turn's end must not lose it from the file.
    expect(storedTranscript(fixture)).toContain("saved answer");
    expect(session.nativeHistorySaved()).toBe(true);
    await host.destroySandbox();
  }, 30_000);

  for (const [name, fault] of [
    ["fails", async () => Promise.reject(new Error("store refused the put"))],
    ["does not finish in time", () => new Promise<void>((r) => setTimeout(r, 1_500))],
  ] as const) {
    it(`still completes the turn when the save ${name}, and marks the native file as behind until a save lands`, async () => {
      const fixture = createHostFixture(model.baseUrl);
      const logs: string[] = [];
      model.script([{ text: "first answer" }]);
      const runner = fixture.runner({ log: (m) => logs.push(m) });
      const { host } = runner.host();
      const session = await host.createSession({ agent: "pi", cwd: fixture.cwd, sessionInit: { cwd: fixture.cwd, mcpServers: [] } });
      await session.setModel("mock/mock-1");
      expect(await session.prompt(prompt("turn one"))).toEqual({ stopReason: "end_turn" });
      expect(session.nativeHistorySaved()).toBe(true);

      fixture.faults.beforePut = async (prefix) => {
        if (prefix === transcriptPrefix) await fault();
      };
      model.script([{ text: "second answer" }]);
      const started = Date.now();
      expect(await session.prompt(prompt("turn two"))).toEqual({ stopReason: "end_turn" });
      expect(Date.now() - started).toBeLessThan(2_500);
      expect(session.nativeHistorySaved()).toBe(false);
      expect(logs.join("\n")).toMatch(/conversation file not saved to the drive.*rebuilds from the conversation's records/);

      // The next turn saves the whole file again: the native file is trusted again.
      fixture.faults.beforePut = undefined;
      await new Promise((r) => setTimeout(r, 1_000)); // a late put ends before the next save queues behind it
      model.script([{ text: "third answer" }]);
      expect(await session.prompt(prompt("turn three"))).toEqual({ stopReason: "end_turn" });
      expect(session.nativeHistorySaved()).toBe(true);
      expect(storedTranscript(fixture)).toContain("second answer");
      await host.destroySandbox();
    }, 30_000);
  }
});
