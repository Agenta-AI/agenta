import { Section, ProseTk } from "./Section";
import { MiniSpineHero } from "./MiniSpineHero";

export function Section00Intro() {
  return (
    <Section id="s0-intro" index="0 / Intro" title="How a request becomes an agent run">
      <ProseTk>
        An Agenta agent does not just call a model once. It hands the request to a harness, a
        program like Pi or Claude Code that reads instructions, calls the model, calls tools, and
        loops until it has an answer. Agenta runs the harness inside a sandbox: an isolated
        process, or on Daytona a whole virtual machine.
      </ProseTk>
      <ProseTk>
        This article follows one request through that machinery: in at the edge, resolved by a
        service, run cold by a runner, back out the way it came. Five tiers, one trip.
      </ProseTk>
      <ProseTk>
        The figures are not illustrations. Each is a small live simulator built from the same
        facts as the prose. Play with them as you read.
      </ProseTk>
      <ProseTk>
        Start with the map: it names every stop and marks what is finished and what is still a
        gap.
      </ProseTk>
      <MiniSpineHero />
    </Section>
  );
}
