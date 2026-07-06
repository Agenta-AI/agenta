import { Section, ProseTk, FigureBreak } from "./Section";
import { LoadSim } from "../figures/load/LoadSim";

export function Section06Load() {
  return (
    <Section id="s6-load" index="6 / Load & scale" title="Load & scale (illustrative)">
      <ProseTk>
        Every turn this article has followed started cold, and that shapes this system under
        load more than anything else. The runner spawns a fresh daemon and harness process for
        each <code>/run</code> call and tears the tree down once the turn ends. Nothing carries
        over, so every request pays the full cold-start cost.
      </ProseTk>
      <ProseTk>
        Today the runner has no concurrency limit and no queue. Every <code>POST /run</code>
        starts immediately; the runner only tracks in-flight sandboxes so it can clean them up on
        shutdown. A local sandbox shares its host with every other run, so overload shows up as
        CPU and memory contention, not a wait in line. A Daytona sandbox gets its own VM, so runs
        keep scaling out until the provider's quotas bite.
      </ProseTk>
      <ProseTk>
        The simulator below defaults to that real, unbounded behavior. Switch to "what-if:
        bounded concurrency" to see a queue form, a hypothetical the code does not implement yet.
        No latency here is measured; the numbers are rough ranges chosen to make the cold-start
        story visible.
      </ProseTk>
      <FigureBreak>
        <LoadSim />
      </FigureBreak>
      <ProseTk>
        The obvious fixes, a bounded queue, more runner replicas, Daytona for fan-out, warm
        sandbox reuse, do not exist yet. Next: the pieces missing outright.
      </ProseTk>
    </Section>
  );
}
