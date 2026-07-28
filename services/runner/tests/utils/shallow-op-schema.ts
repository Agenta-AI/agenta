/**
 * The depth-limited ("shallow") platform-op schemas, read from the shared golden fixture.
 *
 * `commit_revision` and `test_run` used to inline the whole agent-template tree — ~6.4k tokens
 * each, 70% of everything the playground advertised before the model did anything. The SDK now
 * advertises the top-level keys with one-line summaries and points at `references/config-schema.md`
 * (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`, `_shallow_schema`).
 *
 * The runner-side question that raises is whether a deeply nested config still survives the trip:
 * both harnesses check a call against the ADVERTISED schema before it reaches the relay (Pi
 * validates in the extension; an MCP client validates against `tools/list`). These helpers let the
 * Pi and MCP tests answer it with the same schema and the same payload.
 *
 * `advertised_op_schemas.json` is produced and asserted by the Python catalog tests
 * (`test_advertised_op_schemas_match_the_golden` in `test_op_catalog.py`), the same cross-language
 * anchor pattern the `/run` wire contract uses — so these tests can never drift against a stale
 * hand-copy of the schema.
 *
 * Regenerate it after an INTENTIONAL schema change, from `sdks/python` (the SDK logs to stdout at
 * import, so the file is written from Python rather than by shell redirect):
 *
 *     uv run --no-sync python - <<'PY'
 *     import json
 *     from pathlib import Path
 *     from agenta.sdk.agents.platform.op_catalog import get_platform_op
 *
 *     schemas = {
 *         op: get_platform_op(op).resolved_input_schema()
 *         for op in ("commit_revision", "test_run")
 *     }
 *     Path("oss/tests/pytest/unit/agents/golden/advertised_op_schemas.json").write_text(
 *         json.dumps(schemas, indent=2, sort_keys=True) + "\n"
 *     )
 *     PY
 */
import { loadGolden } from "./golden.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";

type AdvertisedOpSchemas = Record<string, Record<string, unknown>>;

/** The advertised input schema for a platform op, as the Python catalog emits it. */
export function shallowOpSchema(op: string): Record<string, unknown> {
  const schemas = loadGolden(
    "advertised_op_schemas.json",
  ) as AdvertisedOpSchemas;
  const schema = schemas[op];
  if (!schema) throw new Error(`no golden advertised schema for op '${op}'`);
  return schema;
}

/** A resolved spec carrying that op's real advertised schema. */
export function shallowOpSpec(op: string): ResolvedToolSpec {
  return {
    name: op,
    description: `${op} (golden advertised schema)`,
    kind: "callback",
    inputSchema: shallowOpSchema(op),
  } as unknown as ResolvedToolSpec;
}

/** The collapsed `parameters.agent` node inside an op's advertised `delta.set`. */
export function advertisedAgentNode(op: string): Record<string, unknown> {
  const schema = shallowOpSchema(op);
  const properties = (schema.properties ?? {}) as Record<string, any>;
  const delta =
    op === "commit_revision"
      ? properties.workflow_revision?.properties?.delta
      : properties.delta;
  return delta?.properties?.set?.properties?.parameters?.properties?.agent;
}

/**
 * A realistic commit payload: every agent-template key populated, each several levels deep, plus an
 * `@ag.embed` build-kit entry. This is exactly the shape the collapsed nodes no longer describe, so
 * it is the payload most at risk from a projection that tightened something.
 */
export const DEEP_AGENT_CONFIG = {
  instructions: { agents_md: "# Agent\nDo the thing." },
  llm: {
    model: "anthropic/claude-opus-4",
    provider: "anthropic",
    extras: { temperature: 0.2, max_tokens: 4096 },
  },
  harness: {
    kind: "claude",
    permissions: { default_mode: "default", allow: ["query_spans"] },
    extras: { max_turns: 12 },
  },
  runner: { kind: "sidecar", permissions: { default: "allow_reads" } },
  sandbox: { kind: "local", permissions: { network: { egress: "deny" } } },
  tools: [
    { type: "builtin", name: "read" },
    { type: "platform", op: "query_spans" },
    {
      "@ag.embed": {
        "@ag.references": { workflow: { slug: "__ag__request_input" } },
      },
    },
  ],
  skills: [{ name: "s", description: "d", body: "b" }],
  mcps: [{ name: "m", command: "npx", args: ["-y", "srv"] }],
};

/** The same payload wrapped as a `commit_revision` tool call. */
export const DEEP_COMMIT_REVISION_ARGS = {
  workflow_revision: {
    message: "wire the reporter",
    delta: {
      set: { parameters: { agent: DEEP_AGENT_CONFIG } },
      remove: ["parameters.agent.mcps"],
    },
  },
};
