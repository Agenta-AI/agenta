/**
 * Pure Pi model-config builder (design Decision 5, planning layer).
 *
 * Translates a neutral `/run` request for a managed OpenAI-compatible custom connection into Pi's
 * native `models.json` plan, WITHOUT any filesystem or sandbox dependency. The materialization
 * (local write / Daytona upload) lives in `pi-assets.ts` and `daytona.ts`; this module only
 * decides whether a plan applies and produces the exact document shape.
 *
 * `models.json` is a Pi mechanism (see the bundled Pi docs `docs/models.md`): it registers a
 * custom provider so pi-acp advertises `<provider-id>/<model-id>` as a settable model. The input
 * here stays neutral — no Pi-specific wire field is introduced.
 */
import type { AgentRunRequest } from "../../protocol.ts";

/** The API dialect this builder emits. The only value v1 supports (design Decision 1). */
export type PiProviderApi = "openai-completions";

/**
 * The canonical env var a managed OpenAI-compatible key resolves into (design Decision 2). The
 * document references it as `$OPENAI_API_KEY`; the raw value never enters the plan or the file.
 */
export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

/** The file Pi reads a custom provider registry from, inside its agent dir (PI_CODING_AGENT_DIR). */
export const PI_MODELS_JSON_FILENAME = "models.json";

/**
 * A validated internal plan for one custom provider and its selected model. Holds only the env var
 * NAME (`apiKeyEnv`), never the key value — the raw key stays in the resolved `secrets` set.
 */
export interface PiModelConfigPlan {
  /** Pi provider id — the connection slug (stable, portable, disambiguates two custom endpoints). */
  providerId: string;
  /** The resolved provider family. Only "openai" in v1. */
  providerFamily: "openai";
  /** The API dialect Pi speaks to the endpoint. */
  api: PiProviderApi;
  /** The custom endpoint base URL (e.g. https://host/v1). */
  baseUrl: string;
  /** The env var Pi reads the key from; the file carries only `$OPENAI_API_KEY`. */
  apiKeyEnv: typeof OPENAI_API_KEY_ENV;
  /** The exact selected model(s). v1 registers exactly one. */
  models: Array<{ id: string }>;
}

/**
 * Thrown when a request is APPLICABLE (a managed OpenAI-compatible custom Pi run) but INCOMPLETE:
 * a required piece (slug, base URL, env credential mode, key, or model) is missing. Fail loud —
 * a run must never silently fall back to a default provider (design Decision 5). Single line so
 * `conciseError` surfaces it verbatim; it never carries the key value.
 */
export class PiModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiModelConfigError";
  }
}

/** Pi identity check, mirroring `buildRunPlan` (an empty harness defaults to `pi_core`). */
function isPiHarness(harness: string | undefined): boolean {
  const resolved = harness || "pi_core";
  return resolved === "pi_core" || resolved === "pi_agenta";
}

/**
 * Applicability (which KIND of run this is) — ALL must hold, else this builder does not apply:
 *   - the harness is Pi;
 *   - the resolved provider family is "openai";
 *   - the resolved deployment is "custom";
 *   - the connection is a named Agenta connection (`mode === "agenta"`).
 *
 * Exported so `buildPiExtensionEnv` can skip the generic Pi provider-override env for runs this
 * models.json path already routes (two competing registrations would race for the provider).
 */
export function isPiModelConfigApplicable(request: AgentRunRequest): boolean {
  return (
    isPiHarness(request.harness) &&
    request.modelConnection?.provider === "openai" &&
    request.modelConnection?.deployment === "custom" &&
    request.connection?.mode === "agenta"
  );
}

/**
 * Build the Pi model-config plan from the neutral run request and the materialized model
 * environment, or return `undefined` when the request is not a managed OpenAI-compatible custom
 * Pi run (current behavior).
 *
 * Applicability is `isPiModelConfigApplicable` above.
 *
 * Completeness (the applicable run has everything it needs) — once applicable, ALL must hold or
 * the request is INCOMPLETE and throws `PiModelConfigError`:
 *   - a non-empty connection slug;
 *   - an endpoint base URL;
 *   - credential mode "env";
 *   - `OPENAI_API_KEY` present in the materialized model environment (`secrets` — on a Daytona
 *     Secrets run this includes the opaque credential BINDINGS, whose in-sandbox value is the
 *     Daytona placeholder);
 *   - a model id.
 *
 * The plan holds only the env var NAME; the raw key never enters it.
 */
export function buildPiModelConfigPlan(
  request: AgentRunRequest,
  secrets: Record<string, string>,
): PiModelConfigPlan | undefined {
  if (!isPiModelConfigApplicable(request)) return undefined;

  const credentialMode = request.modelConnection?.credentialMode;
  const slug = request.connection?.slug?.trim();
  const baseUrl = request.modelConnection?.endpoint?.baseUrl?.trim();
  const model = request.model?.trim();
  const hasKey = !!secrets[OPENAI_API_KEY_ENV]?.trim();

  const missing: string[] = [];
  if (!slug) missing.push("a connection slug");
  if (!baseUrl) missing.push("an endpoint base URL");
  if (credentialMode !== "env")
    missing.push(`credential mode "env" (got "${credentialMode ?? "none"}")`);
  if (!hasKey) missing.push(`${OPENAI_API_KEY_ENV} in the resolved secrets`);
  if (!model) missing.push("a model id");

  if (missing.length > 0) {
    throw new PiModelConfigError(
      `OpenAI-compatible custom connection ${slug ? `'${slug}' ` : ""}is incomplete: ` +
        `missing ${missing.join(", ")}. The run was stopped rather than fall back to a ` +
        `default provider.`,
    );
  }

  // The wire `model` may already be provider-qualified ("openai/gpt-x"). The catalog registers
  // the model UNDER the slug provider, and `environment.ts` requests the fully qualified
  // `<slug>/<model-id>` — so strip the exact declared provider prefix here, otherwise the
  // requested id becomes the double-prefixed "<slug>/openai/gpt-x" and never matches.
  const declaredProvider = request.modelConnection?.provider;
  const stripped =
    declaredProvider && (model as string).startsWith(`${declaredProvider}/`)
      ? (model as string).slice(declaredProvider.length + 1)
      : (model as string);
  const modelId = stripped || (model as string);

  return {
    providerId: slug as string,
    providerFamily: "openai",
    api: "openai-completions",
    baseUrl: baseUrl as string,
    apiKeyEnv: OPENAI_API_KEY_ENV,
    models: [{ id: modelId }],
  };
}

/**
 * Serialize the plan to the exact Pi `models.json` document. The provider is keyed by slug; the
 * key is referenced as `$OPENAI_API_KEY` (never the raw value). Only this plan's one provider and
 * model are written — arbitrary existing providers are never merged into a managed run. Pretty
 * printed with a trailing newline.
 */
export function serializePiModelsJson(plan: PiModelConfigPlan): string {
  const document = {
    providers: {
      [plan.providerId]: {
        baseUrl: plan.baseUrl,
        api: plan.api,
        apiKey: `$${plan.apiKeyEnv}`,
        models: plan.models.map((model) => ({ id: model.id })),
      },
    },
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
