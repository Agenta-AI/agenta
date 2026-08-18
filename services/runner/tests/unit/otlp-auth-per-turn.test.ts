/**
 * The OTLP export bearer is refreshed per TURN, not per session.
 *
 * The bearer lives for minutes; a warm session lives for hours. Capturing it once when the
 * environment was built meant every export after the first few minutes was rejected with
 * `Unauthorized`, which is why no agent traces existed in cloud observability (ASD-EST100).
 * These pin both halves of the loop: the runner rewrites the file at each turn dispatch, and
 * the in-sandbox extension re-reads it at each turn instead of once at process start.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/otlp-auth-per-turn.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import factory, {
  createOtlpAuthRefresher,
  readOtlpAuthFile,
} from "../../src/extensions/agenta.ts";
import { refreshOtlpAuthFile } from "../../src/engines/sandbox_agent/pi-assets.ts";

const tempRoots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "otlp-auth-per-turn-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("the runner writes each turn's bearer to the auth file", () => {
  it("writes the bearer 0600 so only the runtime user can read it", () => {
    const path = join(tempDir(), "relay.otlp-auth");

    refreshOtlpAuthFile(path, "Secret turn-one");

    assert.equal(readFileSync(path, "utf-8"), "Secret turn-one");
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it("overwrites the previous turn's bearer rather than appending", () => {
    const path = join(tempDir(), "relay.otlp-auth");

    refreshOtlpAuthFile(path, "Secret turn-one");
    refreshOtlpAuthFile(path, "Secret turn-two");

    assert.equal(readFileSync(path, "utf-8"), "Secret turn-two");
  });

  it("writes nothing when the run has no auth file (every non-local-Pi placement)", () => {
    // The runner exports those runs itself, from the incoming request, so there is no file.
    refreshOtlpAuthFile(undefined, "Secret turn-one");
  });

  it("leaves the previous turn's bearer in place when a turn carries none", () => {
    const path = join(tempDir(), "relay.otlp-auth");
    refreshOtlpAuthFile(path, "Secret turn-one");

    refreshOtlpAuthFile(path, undefined);

    assert.equal(readFileSync(path, "utf-8"), "Secret turn-one");
  });
});

describe("the extension re-reads the bearer once per turn", () => {
  it("reads the file and deletes it, so the bearer never lingers on disk", () => {
    const path = join(tempDir(), "relay.otlp-auth");
    writeFileSync(path, "Secret turn-one");

    assert.equal(readOtlpAuthFile(path), "Secret turn-one");
    assert.equal(existsSync(path), false);
  });

  it("picks up the bearer the runner wrote for THIS turn", () => {
    const path = join(tempDir(), "relay.otlp-auth");
    const refresh = createOtlpAuthRefresher(path);

    refreshOtlpAuthFile(path, "Secret turn-one");
    assert.equal(refresh(), "Secret turn-one");

    refreshOtlpAuthFile(path, "Secret turn-two");
    assert.equal(refresh(), "Secret turn-two");
  });

  it("keeps the last bearer when a turn's write did not land", () => {
    // A failed write must never make the export worse than the bearer this process already
    // had; it degrades to a stale credential, not to an unauthenticated export.
    const path = join(tempDir(), "relay.otlp-auth");
    const refresh = createOtlpAuthRefresher(path);

    refreshOtlpAuthFile(path, "Secret turn-one");
    assert.equal(refresh(), "Secret turn-one");

    assert.equal(refresh(), "Secret turn-one");
  });

  it("reports no bearer for a run that has no auth file at all", () => {
    assert.equal(createOtlpAuthRefresher(undefined)(), undefined);
  });
});

/** The slice of Pi's ExtensionAPI the tracing path touches, recording what it registers. */
function fakePi() {
  const handlers = new Map<string, Array<() => Promise<void>>>();
  return {
    handlers,
    async fire(event: string) {
      for (const handler of handlers.get(event) ?? []) await handler();
    },
    api: {
      on(event: string, handler: () => Promise<void>) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerTool() {},
      registerProvider() {},
      setActiveTools() {},
      getActiveTools: () => [],
      getAllTools: () => [],
    },
  };
}

describe("the extension arms the per-turn refresh only when it exports traces", () => {
  const OTLP_ENV = [
    "TRACEPARENT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "AGENTA_AGENT_OTLP_AUTH_FILE",
    "AGENTA_AGENT_USAGE_CAPTURE_PATH",
  ] as const;
  const saved = new Map<string, string | undefined>();

  function setEnv(values: Partial<Record<(typeof OTLP_ENV)[number], string>>) {
    for (const key of OTLP_ENV) {
      if (!saved.has(key)) saved.set(key, process.env[key]);
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it("re-reads the file at every turn start, so turn two exports with turn two's bearer", async () => {
    const path = join(tempDir(), "relay.otlp-auth");
    refreshOtlpAuthFile(path, "Secret turn-one");
    setEnv({
      TRACEPARENT:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://example.invalid/otlp/v1/traces",
      AGENTA_AGENT_OTLP_AUTH_FILE: path,
    });

    const pi = fakePi();
    factory(pi.api as never);

    // Turn one: the bearer is read at the turn, not when the process started.
    assert.equal(existsSync(path), true);
    await pi.fire("before_agent_start");
    assert.equal(existsSync(path), false);

    // Turn two reads the file the runner rewrote for it, rather than reusing turn one's
    // bearer. That re-read is the whole fix.
    refreshOtlpAuthFile(path, "Secret turn-two");
    await pi.fire("before_agent_start");
    assert.equal(existsSync(path), false);
  });

  it("leaves the bearer alone for a run that exports nothing", async () => {
    const path = join(tempDir(), "relay.otlp-auth");
    refreshOtlpAuthFile(path, "Secret unused");
    // No traceparent and no endpoint: this run accumulates usage for the runner to write back
    // and exports no spans of its own, so there is no bearer in the sandbox to keep fresh.
    setEnv({
      AGENTA_AGENT_OTLP_AUTH_FILE: path,
      AGENTA_AGENT_USAGE_CAPTURE_PATH: join(tempDir(), "usage.json"),
    });

    const pi = fakePi();
    factory(pi.api as never);
    await pi.fire("before_agent_start");

    assert.equal(readFileSync(path, "utf-8"), "Secret unused");
  });
});
