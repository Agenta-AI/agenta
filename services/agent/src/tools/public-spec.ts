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
  kind?: ResolvedToolSpec["kind"];
  render?: ResolvedToolSpec["render"];
}

/** `client` tools are browser-fulfilled and are not executable by a runner child process. */
export function executableToolSpecs(specs: ResolvedToolSpec[]): ResolvedToolSpec[] {
  return specs.filter((spec) => (spec.kind ?? "callback") !== "client");
}

export function publicToolSpec(spec: ResolvedToolSpec): PublicToolSpec {
  const inputSchema =
    spec.inputSchema ??
    (spec as ResolvedToolSpec & { input_schema?: Record<string, unknown> | null })
      .input_schema;
  const out: PublicToolSpec = {
    name: spec.name,
    description: spec.description,
    inputSchema,
  };
  if (spec.kind) out.kind = spec.kind;
  if (spec.render) out.render = spec.render;
  return out;
}

export function publicToolSpecs(specs: ResolvedToolSpec[]): PublicToolSpec[] {
  return specs.map(publicToolSpec);
}
