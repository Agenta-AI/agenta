# Design

Two levers, in order. Each ships alone and each is useful alone.

| | Win | Leaves | Effort | Touches permissions |
| --- | ---: | ---: | --- | --- |
| **1 — schema diet** | 84% | ~3,000 | 1 Python file | no |
| **2 — lazy schema** | +13% | ~500 | 1 runner function | no |

Baseline is 18,353 tokens ([baseline.md](baseline.md)).

**They are different things and get confused.** What each defers:

| | the schema | the tool entry |
| --- | --- | --- |
| Diet | permanently shorter | present |
| Lazy schema | fetched on request | present |

Both are **token** levers — the tool *count* is unchanged, so neither addresses wander. The lever
that would (**lazy activation**, deferring the tool entry itself) is **out of scope** and is
recorded in [alternatives.md](alternatives.md#3--lazy-activation-out-of-scope).

---

# Lever 1 — schema diet (ship first)

Two ops embed the same 6,441-token object, `_build_agent_template_delta_schema()`
(`op_catalog.py:317`). Two copies = 12,882 tokens = 70% of the bill. Replace the deep expansion
with a shallow schema plus a pointer to prose that already ships.

**Why it costs almost nothing:** `references/config-schema.md` (3,621 tokens, prose + examples)
ships as a `SkillFile` on `BUILD_AN_AGENT_SKILL` (`agenta_builtins.py:740`), and the skill already
says *"Read `references/config-schema.md` before your first `commit_revision`"* (`:579`). That
reference also states the commit endpoint does not validate the config shape. So the embedded JSON
Schema enforces nothing — it duplicates better guidance the model already has on demand.

**Shallow, not empty.** Keep top-level keys (`instructions`, `llm`, `tools`, `mcps`, `skills`,
`harness`, `runner`, `sandbox`) with one-line descriptions; stop before expanding nested `$defs`.
A few hundred tokens instead of 6,441. Implement as a depth limit on `expand_type_refs` so it is
reusable by Lever 2.

**Cost: nested required-field checks inside the collapsed subtree.** Be precise about this, because
the two levers differ. `missingRequiredFields` (`spec-schema.ts`) walks `properties` recursively, so
a deep schema today enforces nested `required` as well as top-level. The diet edits `op_catalog.py`,
which changes the **private** spec too, so those nested checks disappear from every layer including
the relay. Top-level required fields are unaffected.

That is acceptable here and only here: the commit endpoint does not validate the config shape
either, so a malformed nested config already fails at the server rather than being written. It is
not a general licence — see Lever 2, where the private schema is untouched and nothing is lost.

**The shallow schema must be permissive.** Harnesses validate against the *advertised* schema before
the relay sees the call (Pi at `extensions/agenta.ts:318`, MCP at `tool-mcp-http.ts:172`), and Pi's
own framework may apply its JSON Schema more strictly than our required-only check. So the depth
limit must not tighten anything:

- no `additionalProperties: false` on a collapsed node,
- no `required` beyond what the deep schema already required,
- collapsed subtrees typed as bare `object`, never a narrower type or `enum`.

A depth limit that only *removes* constraints cannot reject a payload the deep schema accepted.

---

# Lever 2 — lazy schema

Every op stays advertised under its real name with a one-line description and a **stub** schema.
A `load_op` tool returns the full schema on request.

```text
model → load_op("commit_revision")     returns the schema as a tool result
model → commit_revision({...})          real name, real gate, real execution
```

**Why it is cheap:** one site. `advertisedToolSpecs` (`public-spec.ts:57`) is the single projection
every harness shares — Pi reads it at `pi-assets.ts:353`, the MCP path at `environment.ts:721`.
Stub there and all three harnesses get it. No notification, no transport work, no per-harness code.

**Why it is safe:** the tool name never changes, so every permission gate behaves exactly as today.
And unlike Lever 1, the **private spec is untouched** — the stub lives only in the advertisement
projection, so `assertRequiredArguments` at `relay.ts:327` / `:369` still enforces the full schema,
nested `required` included. Nothing is lost; the check simply moves from the harness to the relay.

**The stub must be permissive too**, for the same reason as Lever 1 and more so, since it is the
only schema the harness sees: `{type: "object"}` with no `required` and no
`additionalProperties: false`. Required fields are then reported by the relay with the exact
field names, which is a usable error for the model. Do **not** stub client tools
(`request_connection`, `request_input`) — the browser fulfils them and they are cheap.

There is precedent for exactly this rule. Codex wraps MCP calls as `{server, tool, arguments}`, which
forced `unwrapCodexMcpArgs` into `storedDecisionKeyShape` (`permission-plan.ts`, PR #5509) so
permission keys match — it normalized the **arguments** and left the **tool name real**, which is
why it needed no gate surgery. Both levers here stay on the same side of that line.

**Cost:** one extra round-trip per distinct op used. Tool count is unchanged, so this does nothing
for wander.

**Discovery stays eager.** Names and one-liners remain in the prompt.

| in the prompt | cost |
| --- | --- |
| 13 names + tight one-liners | ~150 tokens |
| 13 names + today's descriptions | 917 tokens |

If the model cannot see that `create_schedule` exists, it answers "I can't schedule things" while
holding the capability — a silent failure worse than the token bill. Carry the index in the
`load_op` description and the always-read `build-an-agent` skill. Do **not** make discovery a tool
call.

---

## Everything else considered

Eight strategies were weighed, including the **card/menu invoker** that was the original proposal
and was rejected on 2026-07-27. The comparison table, the win each would deliver, and the full
permission analysis live in one place: **[alternatives.md](alternatives.md)**.
