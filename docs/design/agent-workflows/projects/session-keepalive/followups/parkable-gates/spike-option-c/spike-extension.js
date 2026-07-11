/**
 * Option C spike extension.
 *
 * Registers one custom tool, `park_probe`, and gates it in a `tool_call` hook that
 * awaits `ctx.ui.confirm(...)`. Under pi-acp this dialog must surface as an ACP
 * `session/request_permission` to the client. The confirm MESSAGE carries a JSON
 * envelope so we can measure payload fidelity (the real tool-call id + args do NOT
 * ride the ACP request natively; we tunnel them here).
 *
 * Dependency-free on purpose: a plain ESM factory, so Pi's loader needs nothing to
 * resolve. Everything is logged to stderr with an [spike] prefix; the ACP client
 * captures the wire side.
 */
function log(msg) {
  process.stderr.write(`[spike] ${new Date().toISOString()} ${msg}\n`);
}

export default function factory(pi) {
  log("extension loaded");

  pi.registerTool({
    name: "park_probe",
    label: "park_probe",
    description:
      "Test tool for the Option C spike. Echoes back the token it was given.",
    promptSnippet: "Call park_probe with the requested token.",
    promptGuidelines: [
      "When calling park_probe, pass the exact token string the user gave, as the 'token' argument.",
    ],
    parameters: {
      type: "object",
      properties: {
        token: { type: "string", description: "the token to echo" },
      },
      required: ["token"],
      additionalProperties: false,
    },
    async execute(toolCallId, params) {
      log(`execute park_probe id=${toolCallId} params=${JSON.stringify(params)}`);
      const token = params && typeof params === "object" ? params.token : undefined;
      return {
        content: [{ type: "text", text: `EXECUTED park_probe token=${token}` }],
        details: { toolName: "park_probe" },
      };
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "park_probe") return undefined;

    const envelope = {
      v: 1,
      gate: "pi-custom-tool",
      harness: "pi",
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input,
      // deliberately awkward chars to test round-trip fidelity through the message field
      probe: 'quotes"and\\back\\slashes and 日本語 and \n newline',
    };
    const message = JSON.stringify(envelope);
    log(
      `tool_call hook fired for park_probe id=${event.toolCallId} hasUI=${
        ctx && ctx.hasUI
      } mode=${ctx && ctx.mode}; calling ctx.ui.confirm (message ${message.length} bytes)`,
    );

    let confirmed;
    try {
      confirmed = await ctx.ui.confirm("agenta-approval", message);
    } catch (err) {
      log(`ctx.ui.confirm threw: ${err && err.message ? err.message : err}`);
      return { block: true, reason: "confirm errored" };
    }
    log(`ctx.ui.confirm resolved: ${confirmed}`);

    if (confirmed === true) return undefined; // allow -> execute runs
    return { block: true, reason: "denied by agenta spike (Option C)" };
  });
}
