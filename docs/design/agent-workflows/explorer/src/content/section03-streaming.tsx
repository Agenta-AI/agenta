import { Section, ProseTk, FigureBreak } from "./Section";
import { ScenarioFigure } from "../figures/scenario/ScenarioFigure";

export function Section03Streaming() {
  return (
    <Section id="s3-streaming" index="3 / Streaming" title="Streaming (POST /messages)">
      <ProseTk>
        The browser calls <code>POST /messages</code> instead, and asks for a stream, not one
        JSON block. Everything underneath is the same: config parse, tool resolution, cold runner
        turn. What changes is a Vercel protocol adapter wrapped around it, translating the
        browser's chat dialect to the neutral runtime and back.
      </ProseTk>
      <ProseTk>
        A first turn arrives with no <code>session_id</code>, so the adapter mints one; a later
        turn sends one back and the adapter echoes it. The runtime is still cold, so the browser
        resends the whole conversation each time, now as Vercel <code>UIMessage</code> objects,
        which the adapter folds into the same neutral <code>Message</code> shape
        <code> /invoke</code> reads directly.
      </ProseTk>
      <ProseTk>
        The runner does not know a browser is listening. It streams NDJSON as always: one event
        record per thing that happens, one result record at the end. The adapter maps each event
        onto a stream part and frames it as one SSE line until <code>data: [DONE]</code>.
      </ProseTk>
      <ProseTk>
        One detail matters: a failure before the stream opens still comes back as plain JSON,
        even though the browser asked for a stream. The caller gets a clean error or a clean
        stream, never both.
      </ProseTk>
      <FigureBreak>
        <ScenarioFigure scenarioId="messages-streaming" />
      </FigureBreak>
      <ProseTk>
        Batch or streaming, the request eventually needs a tool. Next: that call, from harness to
        the service that runs it.
      </ProseTk>
    </Section>
  );
}
