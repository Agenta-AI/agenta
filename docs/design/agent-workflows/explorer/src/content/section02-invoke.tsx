import { Section, ProseTk, FigureBreak } from "./Section";
import { ScenarioFigure } from "../figures/scenario/ScenarioFigure";

export function Section02Invoke() {
  return (
    <Section id="s2-invoke" index="2 / The journey" title="A request's journey (POST /invoke)">
      <ProseTk>
        A workflow client opens the trip with <code>POST /invoke</code>: chat history plus an
        agent config. The gateway does not know this is an agent; it sees plain JSON and
        dispatches to the agent handler like any other workflow.
      </ProseTk>
      <ProseTk>
        The service parses that config into one typed <code>AgentConfig</code>, then resolves
        tools and secrets before the sandbox starts. A builtin tool like <code>web_search</code>
        needs nothing here; Pi already knows it. A gateway tool calls Agenta's API and comes back
        as a runnable spec with secrets already injected, never exposed to the harness.
      </ProseTk>
      <ProseTk>
        The service then sends one <code>POST /run</code> to the runner. This is where Python
        hands off to TypeScript, and everything the run needs rides across in one payload.
      </ProseTk>
      <ProseTk>
        The runner starts cold: a fresh daemon resolves the harness to an ACP adapter (pi-acp for
        Pi, claude-agent-acp for Claude Code) and spawns the harness CLI. Pi loads Agenta's
        extension on that same start, so the resolved tools become tools Pi can call directly.
        The harness reads its prompt, calls the model, calls tools, and settles on an answer.
      </ProseTk>
      <ProseTk>
        When the turn ends, the runner tears the process tree down and returns one result: output
        text, stop reason, usage. The service stamps that usage on the live workflow span and
        returns one assistant message. Step through the player below to watch the payload change
        at each hop.
      </ProseTk>
      <FigureBreak>
        <ScenarioFigure scenarioId="invoke-batch" />
      </FigureBreak>

      <h3 id="s2-tracing" style={{ marginTop: "2.5rem" }}>
        A note on tracing
      </h3>
      <ProseTk>
        The same request carries a trace. The service threads the current workflow span's trace
        context into <code>/run</code>, so the harness joins that trace instead of starting a new
        one.
      </ProseTk>
      <ProseTk>
        Pi and Claude Code earn it differently. Pi's extension instruments itself: an
        <code> invoke_agent</code> span, one <code>turn N</code> span per loop, a
        <code> chat</code> and <code>execute_tool</code> span under each turn, with real token
        counts. Claude brings no such extension, so the runner builds the same shape by reading
        Claude's ACP event stream.
      </ProseTk>
      <ProseTk>
        One hop closes the loop. Pi's spans and the workflow span travel to Agenta separately, so
        the extension writes real usage to a file on <code>agent_end</code>; the runner reads it
        and returns it on the result, and the service stamps it onto the workflow span. Watch that
        handoff below, then follow the request down the streaming path.
      </ProseTk>
      <FigureBreak>
        <ScenarioFigure scenarioId="tracing" />
      </FigureBreak>
    </Section>
  );
}
