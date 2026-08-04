# Addendum: built-ins leave the agent config entirely

This addendum supersedes the four pieces recorded in [status.md](status.md). Those pieces shipped
in 0.107.0 and fixed the reported symptom, but they put Pi-specific machinery in the wrong place
and produced a confusing authoring surface. This rework removes built-in tools from the agent
config, so the class of bug behind [#5590](https://github.com/Agenta-AI/agenta/issues/5590) can no
longer be expressed.

Read [README.md](README.md) first for the vocabulary. One term changes meaning here: **grant
list** is gone. The `tools` field of a `/run` request no longer decides which built-ins a run may
use.

## The corrected motivation

Issue #5590 was a real bug, not a misunderstanding. A trigger-run Pi agent reached the runner with
`tools: []`, the grant gating then left it with no tools at all, and it could not use its mount.
The playground masked the bug because the build-kit overlay injected `read` and `bash` at run
time, so the same agent worked there and failed everywhere else.

The 0.107.0 fix was right about the symptom and wrong about the location. Putting four
`{"type": "builtin", "name": ...}` entries in the shipped template made a Pi implementation detail
into author-visible configuration: the Tools list grew four rows nobody chose, the built-in
multi-select offered a way to break an agent silently, and every new authoring surface had to
remember to carry the four entries along. The location was the problem, not the values.

## The end state

1. All seven Pi built-ins (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) are always
   active for every Pi run. They appear nowhere in the agent config and nowhere in the Tools list.
   The runner activates all seven every time it starts Pi; Pi alone activates only four.
   Activation is unconditional platform behavior. Permission interception stays conditional on the
   policy.
2. Permission control for Pi happens only through the main policy
   (`runner.permissions.default`: `allow`, `allow_reads`, `ask`, `deny`) and the three editable
   rule lists `harness.permissions.{allow, ask, deny}`. The default is unchanged: all three lists
   empty, policy `allow_reads`, so `read`, `grep`, `find` and `ls` run unattended and `bash`,
   `edit` and `write` show the approval card.
3. The Permissions drawer shows the three lists, editable. The author can pick any of the seven
   canonical names (`Read`, `Bash`, `Edit`, `Write`, `Grep`, `Find`, `Ls`) into allow, ask or
   deny, and pattern rules such as `Bash(npm run:*)` stay supported and visible. A grant made from
   an approval card's "Always allow" lands in the same allow list, under the canonical name, and is
   removable there.
4. Legacy `{"type": "builtin", name}` entries in `tools[]` are accepted and ignored with a
   warning, for one release. They no longer occupy the custom-tool name namespace, but the seven
   built-in names stay reserved: a custom tool named `read` is refused at resolution, because a
   built-in of that name is always available.
5. No shipped template carries tool entries: not the SDK builder, not the service `agent.json` and
   its fallback, not the static catalog template that seeds new accounts, and not the playground
   build-kit overlay.
6. Rule matching for the seven built-in names is case-insensitive. Unknown tool names at the gate
   still fail closed.
7. The `pi_agenta` forced read+bash union (`AGENTA_FORCED_TOOLS`) is obsolete and removed.

## The four decisions

### Migration and dual-read

No data migration. Templates saved since 0.107.0 keep their four builtin entries in the database.
The SDK keeps the `builtin` arm of the `ToolConfig` union so those revisions still parse (the
union is strict, and `coerce_tool_config` also turns a bare string into one), the resolver skips
each entry with a warning, and the web Tools list filters them out so they are invisible and
inert. Nothing writes new ones — including the build-kit authoring agent, whose config-schema
reference was rewritten, because otherwise a config-writing agent would keep producing the legacy
shape and the dual-read window would never close.

The alternative, stripping the entries on read in the frontend or normalizing them on commit, was
rejected: a silent draft rewrite raises a false "unsaved changes" marker the moment a drawer
opens, and a server-side commit rewrite mutates author data for no runtime benefit.

### Case-insensitive rule matching

Normalization happens in the runner only, and only for the seven built-in identities.
`ruleMatches` resolves both the rule's tool part and the gate's tool name through
`piBuiltinIdentity` and compares identities when both resolve; every other name keeps today's
exact, case-sensitive comparison. The prefix body of a pattern rule stays case-sensitive, because
a shell command's case is significant.

Normalizing in the SDK instead was rejected: the same `harness.permissions` lists also render
`.claude/settings.json`, and Claude's own matcher is case-sensitive, so rewriting an author's
`bash` to `Bash` there would change Claude behavior for a Pi-only fix. Folding custom tool names
was rejected too: they are author-chosen and case-significant.

One edge follows from scoping by identity: a custom tool named `read` folds into the built-in
identity, so a single `Read` rule governs both gates. That is the intended reading — the rule
names a tool the author can see called `read` — and a unit test pins it.

### The parity fixture

The cross-language fixture is updated rather than retired, and widened. It now pins each built-in's
canonical rule name and read-only flag alongside its name, because both are product-visible: the
capitalization the permissions editor writes and the gate reports, and the classification that
decides which built-ins auto-run under `allow_reads`.

### The deprecated `tools` wire field

The runner stops reading `request.tools`, but the SDK keeps emitting it and fills it with all
seven lowercase names for a Pi run (Claude keeps `[]`). An old runner — a self-hosted deployment
that updates the API before the runner image, or any mid-deploy skew — still reads the field as a
grant list, and seven names give it the same tool set the new runner activates. Sending `[]` would
recreate #5590 for exactly those deployments; omitting the key would silently drop `grep`, `find`
and `ls`. A new runner ignores the field, so there is no cost.

## Accepted consequences

The product owner signed these off:

- A denied tool is refused at call time, not hidden from the model.
- Agents under policy `allow` that carried custom tools previously ran with no built-ins (a bug);
  they now run all seven unattended.
- `grep`, `find` and `ls` become visible to every Pi agent.
- An author who deselected built-ins in the old multi-select (for example leaving only `read`)
  loses that restriction. The replacement lever is a `deny` rule, and the resolver's warning is
  the only signal they get.
