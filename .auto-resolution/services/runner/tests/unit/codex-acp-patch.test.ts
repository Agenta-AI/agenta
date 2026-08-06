import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { applyCodexAcpApprovalPatch } from "../../src/engines/sandbox_agent/codex-acp-patch.ts";

/**
 * Verbatim from the pinned bundle (`@agentclientprotocol/codex-acp` 1.1.7,
 * `dist/index.js`, `src/AgentMode.ts` section). Keep it byte-exact: the patch's only job
 * is to rewrite this shape, so a fixture that drifts from the real bundle proves nothing.
 */
const AGENT_MODE_SECTION = `// src/AgentMode.ts
var MODE_CONFIG_ID = "mode";
var AgentMode = class _AgentMode {
  static ReadOnly = new _AgentMode(
    "read-only",
    "Read-only",
    "Requires approval to edit files and run commands.",
    "on-request",
    {
      "type": "readOnly",
      "networkAccess": false
    },
    "read-only"
  );
  static Agent = new _AgentMode(
    "agent",
    "Agent",
    "Read and edit files, and run commands.",
    "on-request",
    {
      type: "workspaceWrite",
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    },
    "workspace-write"
  );
  static AgentFullAccess = new _AgentMode(
    "agent-full-access",
    "Agent (full access)",
    "Codex can edit files outside this workspace and run commands with network access. Exercise caution when using.",
    "never",
    { "type": "dangerFullAccess" },
    "danger-full-access"
  );
  static DEFAULT_AGENT_MODE = _AgentMode.Agent;
};
`;

function patchedSource(source: string): string {
  const outcome = applyCodexAcpApprovalPatch(source);
  assert.equal(outcome.kind, "patched");
  return (outcome as { kind: "patched"; source: string }).source;
}

describe("applyCodexAcpApprovalPatch", () => {
  it("flips the full-access preset from never to on-request", () => {
    const patched = patchedSource(AGENT_MODE_SECTION);
    assert.match(
      patched,
      /"agent-full-access",[\s\S]*?"on-request",\s*\{ "type": "dangerFullAccess" \}/,
    );
    assert.equal(patched.includes('"never"'), false);
  });

  it("leaves the sandbox policy and every other preset untouched", () => {
    const patched = patchedSource(AGENT_MODE_SECTION);
    // The whole point is decoupling: full access must stay full access.
    assert.equal(patched.includes('{ "type": "dangerFullAccess" }'), true);
    assert.equal(patched.includes('"danger-full-access"'), true);
    // read-only and agent were already on-request; the patch must not duplicate or drop them.
    assert.equal(patched.split('"on-request"').length - 1, 3);
    assert.equal(patched.includes('"type": "readOnly"'), true);
    assert.equal(patched.includes('type: "workspaceWrite"'), true);
  });

  it("changes nothing else in the bundle", () => {
    const patched = patchedSource(AGENT_MODE_SECTION);
    assert.equal(
      patched,
      AGENT_MODE_SECTION.replace(
        `    "never",\n    { "type": "dangerFullAccess" },`,
        `    "on-request",\n    { "type": "dangerFullAccess" },`,
      ),
    );
  });

  it("is idempotent, so a rebuilt or already-baked adapter is a no-op", () => {
    const patched = patchedSource(AGENT_MODE_SECTION);
    assert.equal(applyCodexAcpApprovalPatch(patched).kind, "already-patched");
  });

  it("reports anchor-missing when the preset drifts, so the image build fails loudly", () => {
    const drifted = AGENT_MODE_SECTION.replace(
      '{ "type": "dangerFullAccess" }',
      '{ "type": "somethingElse" }',
    );
    assert.equal(applyCodexAcpApprovalPatch(drifted).kind, "anchor-missing");
    assert.equal(applyCodexAcpApprovalPatch("").kind, "anchor-missing");
  });

  it("never rewrites a `never` that is not the full-access approval argument", () => {
    // A `"never"` elsewhere in the bundle (an unrelated option, a message string) must survive.
    const withDecoy = `var x = { retry: "never" };\n${AGENT_MODE_SECTION}`;
    const patched = patchedSource(withDecoy);
    assert.equal(patched.includes('var x = { retry: "never" };'), true);
  });
});
