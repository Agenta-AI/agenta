// Option C spike ACP client.
//
// Drives `pi-acp` (which spawns `pi --mode rpc`) over newline-delimited ACP JSON-RPC on
// stdio, using the same @agentclientprotocol/sdk pi-acp itself uses. Logs every ACP message
// verbatim and drives one of four scenarios against the spike extension's approval gate:
//
//   SCENARIO=allow  -> answer the permission "yes" immediately
//   SCENARIO=deny   -> answer "no" immediately
//   SCENARIO=hold   -> hold the permission open for HOLD_MS, then answer "yes" (park test)
//   SCENARIO=drop   -> never answer; after HOLD_MS drop the client transport (EOF to pi-acp)
//
// Everything is logged to $LOGDIR: transcript.jsonl (structured), raw-in.log / raw-out.log
// (verbatim wire bytes), plus pi-stderr.log written by the pi wrapper.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { Readable, Writable, PassThrough } from "node:stream";
import { join } from "node:path";

const SDK =
  "/home/mahmoud/code/agenta/services/runner/node_modules/.pnpm/@agentclientprotocol+sdk@0.26.0_zod@3.25.76/node_modules/@agentclientprotocol/sdk/dist/acp.js";
const { ClientSideConnection, ndJsonStream } = await import(SDK);

const SP = "/tmp/agenta-spike-c";
const PI_ACP = "/home/mahmoud/code/agenta/services/runner/node_modules/pi-acp/dist/index.js";

const SCENARIO = process.env.SCENARIO || "allow";
const HOLD_MS = parseInt(process.env.HOLD_MS || "0", 10);
const LOGDIR = process.env.LOGDIR || join(SP, "logs", SCENARIO);
const TOKEN = process.env.TOKEN || "TOKEN-DEFAULT";
const PROMPT =
  process.env.PROMPT ||
  `Call the park_probe tool exactly once with token "${TOKEN}". Do not call any other tool. After the tool result, reply with just the word done.`;

import { mkdirSync } from "node:fs";
mkdirSync(LOGDIR, { recursive: true });

const transcript = createWriteStream(join(LOGDIR, "transcript.jsonl"));
const rawIn = createWriteStream(join(LOGDIR, "raw-in.log"));
const rawOut = createWriteStream(join(LOGDIR, "raw-out.log"));

function ts() {
  return new Date().toISOString();
}
function rec(dir, event, data) {
  const line = JSON.stringify({ t: ts(), dir, event, data });
  transcript.write(line + "\n");
  process.stdout.write(`${dir} ${event} ${data ? JSON.stringify(data).slice(0, 300) : ""}\n`);
}

const child = spawn("node", [PI_ACP], {
  cwd: join(SP, "proj"),
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: process.env.HOME,
    PI_CODING_AGENT_DIR: join(SP, "piagent"),
    PI_ACP_PI_COMMAND: join(SP, "run-pi.sh"),
  },
});

child.stderr.setEncoding("utf8");
const acpErr = createWriteStream(join(LOGDIR, "pi-acp-stderr.log"));
child.stderr.on("data", (d) => acpErr.write(d));

// tee agent->client bytes to raw-in.log, feed a PassThrough to the ndjson decoder
const inTee = new PassThrough();
child.stdout.on("data", (c) => {
  rawIn.write(c);
  inTee.write(c);
});
child.stdout.on("end", () => inTee.end());

// tee client->agent bytes to raw-out.log, then to child.stdin
const outTee = new PassThrough();
outTee.on("data", (c) => rawOut.write(c));
outTee.pipe(child.stdin);

const input = Readable.toWeb(inTee);
const output = Writable.toWeb(outTee);
const stream = ndJsonStream(output, input);

let dropped = false;

const client = {
  async sessionUpdate(params) {
    const u = params.update || {};
    rec("A->C", "session/update", { sessionId: params.sessionId, kind: u.sessionUpdate, update: u });
  },
  async requestPermission(params) {
    rec("A->C", "session/request_permission", params);
    const title = params.toolCall && params.toolCall.title;
    const options = params.options || [];
    const pick = (want) => {
      const o =
        options.find((x) => x.optionId === want) ||
        options.find((x) => (x.kind || "").includes("allow")) ||
        options[0];
      return o && o.optionId;
    };

    // Anything that is not our gate (e.g. a project-trust prompt) -> auto-allow to proceed.
    if (title !== "agenta-approval") {
      const optionId = pick("yes");
      rec("C->A", "permission-auto-allow(non-gate)", { title, optionId });
      return { outcome: { outcome: "selected", optionId } };
    }

    if (SCENARIO === "rejecterr") {
      // Reject the ACP request itself (daemon stays alive). pi-acp's requestExtensionPermission
      // catch should map this to a cancelled dialog -> confirm resolves false -> hook denies.
      rec("C->A", "permission-answer", { decision: "throw-request-error" });
      const err = new Error("client refuses permission (simulated ACP error)");
      throw err;
    }
    if (SCENARIO === "allow") {
      rec("C->A", "permission-answer", { decision: "allow" });
      return { outcome: { outcome: "selected", optionId: pick("yes") } };
    }
    if (SCENARIO === "deny") {
      rec("C->A", "permission-answer", { decision: "deny" });
      return { outcome: { outcome: "selected", optionId: options.find((x) => x.optionId === "no")?.optionId || "no" } };
    }
    if (SCENARIO === "hold" || SCENARIO === "drop") {
      const start = Date.now();
      rec("HOLD", "park-begin", { holdMs: HOLD_MS, scenario: SCENARIO });
      // heartbeat so we can prove the request stays pending and nothing reaps it
      const hb = setInterval(() => {
        rec("HOLD", "still-pending", { elapsedMs: Date.now() - start });
      }, 15000);
      await new Promise((r) => setTimeout(r, HOLD_MS));
      clearInterval(hb);
      if (SCENARIO === "drop") {
        rec("DROP", "dropping-transport", { elapsedMs: Date.now() - start });
        dropped = true;
        // Simulate the ACP connection dropping while the request is pending:
        // EOF pi-acp's stdin and tear down our read side, never answering.
        try { child.stdin.end(); } catch {}
        try { child.stdout.destroy(); } catch {}
        // give pi-acp/pi a moment to react, capture stderr, then exit
        setTimeout(() => finish(0), 6000);
        // Return a never-resolving promise; the transport is gone anyway.
        return new Promise(() => {});
      }
      rec("C->A", "permission-answer", { decision: "allow-after-hold", elapsedMs: Date.now() - start });
      return { outcome: { outcome: "selected", optionId: pick("yes") } };
    }
    return { outcome: { outcome: "cancelled" } };
  },
  async readTextFile() {
    throw new Error("readTextFile not supported in spike");
  },
  async writeTextFile() {
    return {};
  },
};

const conn = new ClientSideConnection(() => client, stream);

function finish(code) {
  rec("CLIENT", "finish", { code });
  try { child.kill("SIGKILL"); } catch {}
  setTimeout(() => process.exit(code), 300);
}

(async () => {
  try {
    const initRes = await conn.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
    rec("C->A", "initialize.result", initRes);

    const sess = await conn.newSession({ cwd: join(SP, "proj"), mcpServers: [] });
    rec("C->A", "session/new.result", sess);
    const sessionId = sess.sessionId;

    rec("C->A", "session/prompt.send", { prompt: PROMPT });
    const promptRes = await conn.prompt({
      sessionId,
      prompt: [{ type: "text", text: PROMPT }],
    });
    rec("A->C", "session/prompt.result", promptRes);
    finish(0);
  } catch (err) {
    if (dropped) {
      rec("CLIENT", "post-drop-error(expected)", { message: String(err && err.message ? err.message : err) });
      return;
    }
    rec("CLIENT", "fatal", { message: String(err && err.stack ? err.stack : err) });
    finish(1);
  }
})();

// safety net: never run forever
setTimeout(() => {
  rec("CLIENT", "watchdog-timeout", {});
  finish(2);
}, parseInt(process.env.MAX_MS || "180000", 10));
