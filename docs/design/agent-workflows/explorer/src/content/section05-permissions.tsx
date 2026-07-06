import { Section, ProseTk, FigureBreak } from "./Section";
import { ScenarioFigure } from "../figures/scenario/ScenarioFigure";
import { PermissionSimulator } from "../figures/permissions/PermissionSimulator";

export function Section05Permissions() {
  return (
    <Section id="s5-permissions" index="5 / Permissions" title="Permissions: one decision, two gates">
      <ProseTk>
        Every tool call answers to one function: <code>decide()</code>. It checks four things in
        order and stops at the first with an opinion: an explicit permission on the tool, then a
        user-declared MCP server's own permission, then an authored rule matching the tool's
        name (strictest wins if several fire), then the run's default. An explicit
        <code> allow</code> or <code>deny</code> always wins outright, in either direction. Under
        the default <code>allow_reads</code>, a read-only tool runs immediately; anything else
        asks.
      </ProseTk>
      <ProseTk>
        Two gates call that function, and which one fires depends on the harness. Claude Code
        gates itself first: before the session starts, the SDK renders a
        <code> .claude/settings.json</code> with a rule for every resolved tool, so a decided call
        never reaches Agenta's code. Only an undecided call reaches the ACP approval responder,
        which calls <code>decide()</code> itself. Pi has no self-gate: every call, its own
        builtins included, goes through the file relay, Pi's only enforcement point.
      </ProseTk>
      <ProseTk>
        A client tool, one that needs the browser to answer, follows its own short ladder: an
        explicit deny blocks it, and every other case pauses for the browser. It never resolves
        server-side.
      </ProseTk>
      <ProseTk>
        An <code>ask</code> verdict pauses the turn rather than failing it. The run stops with
        <code> stopReason: "paused"</code> and asks the user; the next turn resends the
        conversation with that answer folded in. The responder matches the resumed call by tool
        name and exact arguments, so a different call with the same name asks again fresh.
      </ProseTk>
      <FigureBreak>
        <ScenarioFigure scenarioId="permission-ask-hitl" />
      </FigureBreak>
      <ProseTk>
        One nuance is easy to overstate. An operator kill switch,
        <code> SANDBOX_AGENT_DENY_PERMISSIONS</code>, is often described as denying everything.
        The code is narrower: it forces the default to deny, but an explicit per-tool
        <code> allow</code> still wins. Compose a policy and the kill switch below and watch which
        gate wins.
      </ProseTk>
      <FigureBreak>
        <PermissionSimulator />
      </FigureBreak>
      <ProseTk>
        Permissions decide whether one call runs. Next: what happens when many requests hit the
        runner at once.
      </ProseTk>
    </Section>
  );
}
