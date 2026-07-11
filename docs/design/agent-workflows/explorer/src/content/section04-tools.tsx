import { useState } from "react";
import { Section, ProseTk, FigureBreak } from "./Section";
import { ScenarioFigure } from "../figures/scenario/ScenarioFigure";

const TABS = [
  { id: "gateway-tool-call", label: "Local sandbox" },
  { id: "daytona-tool-relay", label: "Daytona sandbox" },
] as const;

export function Section04Tools() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("gateway-tool-call");

  return (
    <Section id="s4-tools" index="4 / Tools" title="Tools: resolve, call, relay">
      <ProseTk>
        Every declared tool carries a <code>type</code>: builtin, gateway, code, client,
        reference, or platform. The type says who fulfils the call, and the service settles that
        once, before the sandbox starts. A gateway tool, a Composio action like filing a GitHub
        issue, resolves through <code>POST /tools/resolve</code> into a call the harness can run
        without seeing the connection's credentials. A code tool runs as its own subprocess with
        only its own secrets.
      </ProseTk>
      <ProseTk>
        A client tool breaks the pattern: nothing server-side can fulfil "ask the user to pick a
        date," so it pauses the turn for the browser to answer later. Every other type resolves to
        one of three runtime kinds, <code>callback</code>, <code>code</code>, or
        <code> client</code>, and that kind, not the type, is what the runner reads.
      </ProseTk>
      <ProseTk>
        Where the call lands depends on the sandbox. Locally, Pi's extension shares a host with
        the runner and posts the call straight back to Agenta's API. On Daytona, there is no path
        back: the extension runs in a remote VM, so it leaves a request file instead. The runner
        polls that file, executes the call, and writes the answer to a response file the sandbox
        is waiting on. Same call, same result, one extra hop through the filesystem.
      </ProseTk>
      <div className="step-controls" style={{ marginBottom: "0.5rem" }}>
        {TABS.map((t) => (
          <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <FigureBreak>
        <ScenarioFigure scenarioId={tab} />
      </FigureBreak>
      <ProseTk>
        Resolving a tool is only half the story. Next: who decides whether the call is allowed to
        run at all.
      </ProseTk>
    </Section>
  );
}
