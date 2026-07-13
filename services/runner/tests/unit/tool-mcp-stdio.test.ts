/**
 * Unit + integration-style tests for the in-sandbox stdio MCP shim
 * (src/tools/tool-mcp-stdio.ts): the Daytona tool advertiser for an MCP-client harness
 * (Claude). The shim speaks newline-delimited MCP JSON-RPC over stdio and, on `tools/call`,
 * publishes a relay request file through the shared relay client, which the runner-side relay
 * loop executes.
 *
 * Semantic contract tests, not byte goldens (the relay wire-format golden lives in
 * relay-client.test.ts):
 *  - the env/specs-file contract fails LOUD on any defect (`loadShimConfig`),
 *  - the pure handler mirrors tool-mcp-http.ts (initialize / tools-list / tools-call), serves
 *    only public fields, honors the snake-case `input_schema` accessor, and never writes a
 *    relay file for an unknown tool,
 *  - the shim's published request is accepted end-to-end by a REAL `startToolRelay` loop over
 *    `localRelayHost()` (mocked executor via a stubbed fetch),
 *  - concurrent calls get distinct request files and distinct responses,
 *  - the stdio loop emits only complete JSON-RPC lines on stdout.
 *
 * Run: pnpm exec vitest run tests/unit/tool-mcp-stdio.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  PUBLIC_SPECS_FILE_ENV,
  RELAY_DIR_ENV,
  handleToolMcpMessage,
  loadShimConfig,
  runToolMcpStdio,
} from "../../src/tools/tool-mcp-stdio.ts";
import type { AdvertisedToolSpec } from "../../src/tools/public-spec.ts";
import {
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
} from "../../src/tools/relay-protocol.ts";
import { localRelayHost, startToolRelay } from "../../src/tools/relay.ts";
import { publishRelayRequest } from "../../src/tools/relay-client.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";

const specs: AdvertisedToolSpec[] = [
  {
    name: "get_weather",
    description: "Get the weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } } },
    kind: "callback",
    timeoutMs: 5_000,
  },
  {
    // Snake-case platform-catalog shape: no camelCase inputSchema at all. The advertisement
    // must read `input_schema` (the shared-accessor rule), never advertise an empty schema.
    name: "commit_revision",
    description: "Commit a revision",
    input_schema: {
      type: "object",
      properties: { message: { type: "string" } },
    },
  } as AdvertisedToolSpec,
];

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});

const realFetch = globalThis.fetch;

function stubFetch(reply: (args: unknown) => string): Array<{ body: any }> {
  const calls: Array<{ body: any }> = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ body });
    return new Response(reply(body?.data?.function?.arguments), {
      status: 200,
    });
  }) as typeof fetch;
  return calls;
}

async function waitFor(pred: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

describe("loadShimConfig (fail-loud env contract)", () => {
  const specsFileOf = (contents: string): string => {
    const dir = tempDir("agenta-tool-mcp-specs-");
    const path = join(dir, "tool-mcp-specs.json");
    writeFileSync(path, contents, "utf-8");
    return path;
  };

  it("loads relay dir + specs from the two env names", () => {
    const specsFile = specsFileOf(JSON.stringify(specs));
    const loaded = loadShimConfig({
      [RELAY_DIR_ENV]: "/relay/dir",
      [PUBLIC_SPECS_FILE_ENV]: specsFile,
    });
    assert.ok(loaded.ok);
    if (!loaded.ok) return;
    assert.equal(loaded.config.relayDir, "/relay/dir");
    assert.deepEqual(
      loaded.config.specs.map((s) => s.name),
      ["get_weather", "commit_revision"],
    );
  });

  it("fails on a missing relay dir env", () => {
    const loaded = loadShimConfig({
      [PUBLIC_SPECS_FILE_ENV]: specsFileOf("[]"),
    });
    assert.ok(!loaded.ok && loaded.error.includes(RELAY_DIR_ENV));
  });

  it("fails on a missing specs-file env", () => {
    const loaded = loadShimConfig({ [RELAY_DIR_ENV]: "/relay/dir" });
    assert.ok(!loaded.ok && loaded.error.includes(PUBLIC_SPECS_FILE_ENV));
  });

  it("fails on an unreadable specs file", () => {
    const loaded = loadShimConfig({
      [RELAY_DIR_ENV]: "/relay/dir",
      [PUBLIC_SPECS_FILE_ENV]: join(tmpdir(), "definitely-missing-specs.json"),
    });
    assert.ok(!loaded.ok && loaded.error.includes("cannot read specs file"));
  });

  it("fails on bad JSON and on a non-array", () => {
    for (const [contents, needle] of [
      ["{not json", "bad JSON"],
      ['{"name":"x"}', "JSON array"],
    ] as const) {
      const loaded = loadShimConfig({
        [RELAY_DIR_ENV]: "/relay/dir",
        [PUBLIC_SPECS_FILE_ENV]: specsFileOf(contents),
      });
      assert.ok(!loaded.ok && loaded.error.includes(needle));
    }
  });
});

describe("tool-mcp-stdio handler", () => {
  it("initialize -> serverInfo + tools capability, echoing the client's protocol version", async () => {
    const res: any = await handleToolMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      },
      specs,
      tempDir("agenta-tool-mcp-"),
    );
    assert.equal(res.id, 1);
    assert.equal(res.result.protocolVersion, "2024-11-05");
    assert.equal(res.result.serverInfo.name, "agenta-tools");
    assert.ok(res.result.capabilities.tools);
  });

  it("a notification (no id) returns undefined (no response written)", async () => {
    const res = await handleToolMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      specs,
      tempDir("agenta-tool-mcp-"),
    );
    assert.equal(res, undefined);
  });

  it("ping -> an empty successful result", async () => {
    const res: any = await handleToolMcpMessage(
      { jsonrpc: "2.0", id: 7, method: "ping" },
      specs,
      tempDir("agenta-tool-mcp-"),
    );
    assert.deepEqual(res, { jsonrpc: "2.0", id: 7, result: {} });
  });

  it("a structurally invalid message -> -32600", async () => {
    const res: any = await handleToolMcpMessage(
      { jsonrpc: "2.0", id: 8, params: {} },
      specs,
      tempDir("agenta-tool-mcp-"),
    );
    assert.deepEqual(res, {
      jsonrpc: "2.0",
      id: 8,
      error: { code: -32600, message: "invalid request" },
    });
  });

  it("tools/list advertises only public fields and honors the snake-case input_schema", async () => {
    const res: any = await handleToolMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      specs,
      tempDir("agenta-tool-mcp-"),
    );
    assert.deepEqual(
      res.result.tools.map((t: any) => t.name),
      ["get_weather", "commit_revision"],
    );
    for (const tool of res.result.tools) {
      assert.deepEqual(Object.keys(tool).sort(), [
        "description",
        "inputSchema",
        "name",
      ]);
    }
    // Snake-case accessor: the platform-catalog spec advertises its real schema, not {}.
    assert.ok(res.result.tools[1].inputSchema.properties.message);
    const serialized = JSON.stringify(res);
    assert.ok(!serialized.includes("callRef"));
    assert.ok(!serialized.includes("authorization"));
    assert.ok(!serialized.includes("timeoutMs"));
  });

  it("tools/call for an unknown tool -> -32602 and NO relay file is written", async () => {
    const dir = tempDir("agenta-tool-mcp-");
    const res: any = await handleToolMcpMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "nope", arguments: {} },
      },
      specs,
      dir,
    );
    assert.equal(res.error.code, -32602);
    assert.deepEqual(readdirSync(dir), []);
  });

  it("an unknown method -> -32601", async () => {
    const res: any = await handleToolMcpMessage(
      { jsonrpc: "2.0", id: 4, method: "tools/frobnicate" },
      specs,
      tempDir("agenta-tool-mcp-"),
    );
    assert.equal(res.error.code, -32601);
  });

  it("tools/call maps a not-ok relay response to an MCP isError result", async () => {
    const dir = tempDir("agenta-tool-mcp-");
    const pending = handleToolMcpMessage(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get_weather", arguments: {} },
      },
      specs,
      dir,
    );
    await waitFor(() =>
      readdirSync(dir).some((f) => f.endsWith(RELAY_REQ_SUFFIX)),
    );
    const reqName = readdirSync(dir).find((f) => f.endsWith(RELAY_REQ_SUFFIX))!;
    const id = reqName.slice(0, -RELAY_REQ_SUFFIX.length);
    writeFileSync(
      join(dir, `${id}${RELAY_RES_SUFFIX}`),
      JSON.stringify({ ok: false, error: "upstream 500" }),
      "utf-8",
    );
    const res: any = await pending;
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /upstream 500/);
  });
});

describe("shim -> real relay loop round trip (semantic writer/reader contract)", () => {
  const resolvedSpec: ResolvedToolSpec = {
    name: "get_weather",
    kind: "callback",
    callRef: "composio.weather.GET_WEATHER",
    description: "Get the weather",
  };

  it("a tools/call published by the shim is executed by startToolRelay(localRelayHost())", async () => {
    const dir = tempDir("agenta-tool-mcp-relay-");
    const fetchCalls = stubFetch((args) => `RELAY-OK ${JSON.stringify(args)}`);

    // The REAL runner-side loop over the REAL local host — the same reader Pi's writer talks
    // to — with the executor mocked at the network boundary (the callback POST).
    const relay = startToolRelay(localRelayHost(), dir, [resolvedSpec], {
      endpoint: "https://agenta.example/api/tools/call",
      authorization: "ApiKey k",
    });
    await relay.ready;
    try {
      const res: any = await handleToolMcpMessage(
        {
          jsonrpc: "2.0",
          id: 10,
          method: "tools/call",
          params: { name: "get_weather", arguments: { city: "Berlin" } },
        },
        specs,
        dir,
      );
      assert.ok(!res.result.isError, JSON.stringify(res));
      assert.equal(res.result.content[0].text, 'RELAY-OK {"city":"Berlin"}');

      // The real reader accepted the shim's request record shape.
      assert.equal(fetchCalls.length, 1);
      assert.equal(
        fetchCalls[0].body.data.function.name,
        "composio.weather.GET_WEATHER",
      );
      assert.deepEqual(fetchCalls[0].body.data.function.arguments, {
        city: "Berlin",
      });

      // No residue: the writer deleted req+res, and no atomic-publication temp name was ever
      // published under a final relay suffix (temp names never match the suffix filters).
      await waitFor(() => readdirSync(dir).length === 0);
    } finally {
      await relay.stop();
    }
  });

  it("crash-after-write: a writer that never consumes its response leaves the loop healthy (at-least-once)", async () => {
    // The plan's Lifecycle property: the relay executes and PUBLISHES the response even when
    // the in-sandbox writer died right after publishing its request — the response file is
    // simply never consumed. The side effect happened (at-least-once, never lost), the
    // unconsumed `.res.json` is inert residue for the rest of the turn (only the next turn's
    // stale sweep clears it), and the loop keeps serving later calls normally.
    const dir = tempDir("agenta-tool-mcp-crash-");
    const fetchCalls = stubFetch((args) => `RELAY-OK ${JSON.stringify(args)}`);

    const relay = startToolRelay(localRelayHost(), dir, [resolvedSpec], {
      endpoint: "https://agenta.example/api/tools/call",
      authorization: "ApiKey k",
    });
    await relay.ready;
    try {
      // Publish through the REAL relay client (the same writer the shim and the Pi extension
      // use), then never wait on the response — the "writer crashed after the write".
      const { resPath } = publishRelayRequest(dir, {
        toolName: "get_weather",
        toolCallId: "crashed-writer",
        args: { city: "Berlin" },
      });

      await waitFor(() => existsSync(resPath));
      assert.equal(
        fetchCalls.length,
        1,
        "the executor ran (side effect happened)",
      );
      const res = JSON.parse(readFileSync(resPath, "utf-8"));
      assert.equal(res.ok, true);
      assert.equal(res.text, 'RELAY-OK {"city":"Berlin"}');

      // The loop stays healthy: a subsequent NORMAL round trip (published and consumed by the
      // shim handler) still works end to end.
      const followUp: any = await handleToolMcpMessage(
        {
          jsonrpc: "2.0",
          id: 11,
          method: "tools/call",
          params: { name: "get_weather", arguments: { city: "Paris" } },
        },
        specs,
        dir,
      );
      assert.ok(!followUp.result.isError, JSON.stringify(followUp));
      assert.equal(
        followUp.result.content[0].text,
        'RELAY-OK {"city":"Paris"}',
      );
      assert.equal(fetchCalls.length, 2);

      // The crashed writer's response file REMAINS unconsumed (nothing sweeps it mid-turn),
      // and its request file is gone (delete-on-pickup).
      assert.ok(existsSync(resPath), "the unconsumed response file survives");
      assert.deepEqual(
        readdirSync(dir),
        ["crashed-writer.res.json"],
        "only the orphaned response remains",
      );
    } finally {
      await relay.stop();
    }
  });

  it("two concurrent tools/call get DISTINCT request files and their own responses", async () => {
    const dir = tempDir("agenta-tool-mcp-conc-");
    // No relay loop here: answer the two requests manually so each response is tied to its
    // own request id and the pairing is asserted end to end.
    const first = handleToolMcpMessage(
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: { name: "get_weather", arguments: { city: "Berlin" } },
      },
      specs,
      dir,
    );
    const second = handleToolMcpMessage(
      {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: { name: "get_weather", arguments: { city: "Paris" } },
      },
      specs,
      dir,
    );

    await waitFor(
      () =>
        readdirSync(dir).filter((f) => f.endsWith(RELAY_REQ_SUFFIX)).length ===
        2,
    );
    const reqNames = readdirSync(dir).filter((f) =>
      f.endsWith(RELAY_REQ_SUFFIX),
    );
    assert.equal(new Set(reqNames).size, 2, "distinct relay request files");
    for (const reqName of reqNames) {
      const req = JSON.parse(readFileSync(join(dir, reqName), "utf-8"));
      assert.equal(req.toolName, "get_weather");
      const id = reqName.slice(0, -RELAY_REQ_SUFFIX.length);
      writeFileSync(
        join(dir, `${id}${RELAY_RES_SUFFIX}`),
        JSON.stringify({ ok: true, text: `city=${req.args.city}` }),
        "utf-8",
      );
    }

    const [resA, resB]: any[] = await Promise.all([first, second]);
    assert.equal(resA.id, 21);
    assert.equal(resA.result.content[0].text, "city=Berlin");
    assert.equal(resB.id, 22);
    assert.equal(resB.result.content[0].text, "city=Paris");
  });
});

describe("stdio loop", () => {
  it("stdout carries only complete JSON-RPC lines; notifications produce none", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf-8")));

    const done = runToolMcpStdio(
      specs,
      tempDir("agenta-tool-mcp-loop-"),
      input,
      output,
    );
    input.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`,
    );
    input.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    input.write("\n"); // blank line: ignored
    input.write("{not json}\n"); // parse error: logged and answered with id:null
    input.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
    );
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "nope", arguments: {} },
      })}\n`,
    );
    input.end();
    await done;

    // Every write is one complete `<json>\n` line — parse each individually.
    const responses = chunks.map((chunk) => {
      assert.ok(
        chunk.endsWith("\n"),
        "each response is a newline-terminated line",
      );
      return JSON.parse(chunk);
    });
    // 4 responses (initialize, parse error, tools/list, unknown-tool error); the notification
    // and blank line produce nothing on stdout.
    assert.deepEqual(
      responses.map((r) => r.id),
      [1, null, 2, 3],
    );
    for (const response of responses) assert.equal(response.jsonrpc, "2.0");
    assert.equal(responses[1].error.code, -32700);
    assert.equal(responses[3].error.code, -32602);
  });

  it("keeps reading while a tools/call is in flight (interleaved responses stay valid)", async () => {
    const dir = tempDir("agenta-tool-mcp-inflight-");
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: any[] = [];
    let buffered = "";
    output.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf-8");
      let index;
      while ((index = buffered.indexOf("\n")) >= 0) {
        lines.push(JSON.parse(buffered.slice(0, index)));
        buffered = buffered.slice(index + 1);
      }
    });

    const done = runToolMcpStdio(specs, dir, input, output);
    // A tools/call that blocks on the relay wait...
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: { name: "get_weather", arguments: { city: "Rome" } },
      })}\n`,
    );
    await waitFor(() =>
      readdirSync(dir).some((f) => f.endsWith(RELAY_REQ_SUFFIX)),
    );
    // ...must not block a pipelined tools/list from being answered first.
    input.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 31, method: "tools/list" })}\n`,
    );
    await waitFor(() => lines.some((l) => l.id === 31));
    assert.ok(
      !lines.some((l) => l.id === 30),
      "the blocked tools/call has not answered yet",
    );

    const reqName = readdirSync(dir).find((f) => f.endsWith(RELAY_REQ_SUFFIX))!;
    const id = reqName.slice(0, -RELAY_REQ_SUFFIX.length);
    writeFileSync(
      join(dir, `${id}${RELAY_RES_SUFFIX}`),
      JSON.stringify({ ok: true, text: "sunny" }),
      "utf-8",
    );
    input.end();
    await done;
    const callResponse = lines.find((l) => l.id === 30);
    assert.equal(callResponse.result.content[0].text, "sunny");
  });
});
