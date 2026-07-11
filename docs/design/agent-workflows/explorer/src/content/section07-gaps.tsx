import { Section, ProseTk, FigureBreak } from "./Section";
import { TopologyFigure } from "../figures/topology/TopologyFigure";
import { metaModel } from "../model";

export function Section07Gaps() {
  return (
    <Section id="s7-gaps" index="7 / What's not real yet" title="What's not real yet">
      <ProseTk>
        Everything so far describes code that runs today. A few pieces do not, and a newcomer who
        designs against them as if they did will build on sand. The map below spotlights every
        node marked dashed or dotted.
      </ProseTk>
      <ProseTk>
        Sessions are cold everywhere, and no durable store backs them; a client that wants history
        on screen must keep and resend it. The SDK's <code>LocalBackend</code> adapter, for
        running a harness without the sandbox-agent daemon, raises
        <code> NotImplementedError</code>, and the deployed service never selects it.
      </ProseTk>
      <ProseTk>
        <code>pi_agenta</code>, the <code>AgentaHarness</code>, runs end to end like plain Pi, but
        its forced preamble, persona, and skills are still placeholder text. On that same Pi path,
        a caller's model override is silently ignored; pi-acp only ever runs its own default.
      </ProseTk>
      <ProseTk>
        Tool delivery has its own edges. User-declared MCP servers are gated off by default, and
        even switched on, the runner delivers them to Claude Code only, never Pi. The runner
        probes each harness's capabilities on every run, but nothing outside one internal branch
        reads that back. Triggers, invoking an agent from an external event, exist only as a
        read-only discovery operation; the rest is not built.
      </ProseTk>
      <FigureBreak>
        <TopologyFigure mode="gaps" allowModeToggle={false} />
      </FigureBreak>
      <ul>
        {metaModel.gaps.map((gap) => (
          <li key={gap.id}>
            <strong>{gap.id}</strong>: {gap.summary}
          </li>
        ))}
      </ul>
      <ProseTk>
        None of this is a reason to distrust the rest of the article. It is a reason to check,
        which the sources below let you do.
      </ProseTk>
    </Section>
  );
}
