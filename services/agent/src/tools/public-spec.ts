/**
 * Public tool metadata safe to expose to harness child processes.
 *
 * ResolvedToolSpec also carries executor-private fields (`callRef`, `code`, scoped `env`,
 * runtime). Those must stay in runner memory. Child processes only need the advertisement
 * shape so the model can choose a tool; every execution is relayed back to the runner.
 */
import type { ResolvedToolSpec } from "../protocol.ts";

export interface PublicToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown> | null;
}

/** `client` tools are browser-fulfilled and are not executable by a runner child process. */
export function executableToolSpecs(specs: ResolvedToolSpec[]): ResolvedToolSpec[] {
  return specs.filter((spec) => (spec.kind ?? "callback") !== "client");
}

export function publicToolSpec(spec: ResolvedToolSpec): PublicToolSpec {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
  };
}

export function publicToolSpecs(specs: ResolvedToolSpec[]): PublicToolSpec[] {
  return executableToolSpecs(specs).map(publicToolSpec);
}
