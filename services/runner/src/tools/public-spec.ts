/**
 * Public tool metadata safe to expose to harness child processes.
 *
 * ResolvedToolSpec also carries executor-private fields (`callRef`, `code`, scoped `env`,
 * runtime, contextBindings). Those must stay in runner memory. Child processes only need the
 * advertisement shape so the model can choose a tool; every execution is relayed back to the
 * runner. `timeoutMs` is public because the child relay wait needs the same per-tool budget.
 */
import type { ResolvedToolSpec } from "../protocol.ts";
import { specInputSchema } from "./spec-schema.ts";

export interface AdvertisedToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown> | null;
  kind?: ResolvedToolSpec["kind"];
  render?: ResolvedToolSpec["render"];
  timeoutMs?: ResolvedToolSpec["timeoutMs"];
}

/** `client` tools are browser-fulfilled and are not executable by a runner child process. */
export function executableToolSpecs(specs: ResolvedToolSpec[]): ResolvedToolSpec[] {
  return specs.filter((spec) => (spec.kind ?? "callback") !== "client");
}

export function advertisedToolSpec(spec: ResolvedToolSpec): AdvertisedToolSpec {
  const out: AdvertisedToolSpec = {
    name: spec.name,
    description: spec.description,
    inputSchema: specInputSchema(spec),
  };
  if (spec.kind) out.kind = spec.kind;
  if (spec.render) out.render = spec.render;
  if (spec.timeoutMs !== undefined) out.timeoutMs = spec.timeoutMs;
  return out;
}

/**
 * The advertisement shape for EVERY advertisable spec — including `client` tools, which the
 * model must SEE (e.g. `request_connection`) even though the browser, not the runner, fulfils
 * them. (Contrast `executableToolSpecs`, which is the gatekeeper for the execute paths.)
 */
export function advertisedToolSpecs(specs: ResolvedToolSpec[]): AdvertisedToolSpec[] {
  return specs.map(advertisedToolSpec);
}
