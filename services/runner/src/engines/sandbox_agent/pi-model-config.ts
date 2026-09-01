/**
 * Pure Pi model-config builders (design Decision 5, planning layer).
 *
 * Translates a neutral `/run` request into Pi's native `models.json` plan, WITHOUT any filesystem
 * or sandbox dependency. The materialization (local write / Daytona upload) lives in
 * `pi-assets.ts` and `daytona.ts`; this module only decides whether a plan applies and produces
 * the exact document shape.
 *
 * `models.json` is a Pi mechanism (see the bundled Pi docs `docs/models.md`), and Pi reads it two
 * ways. This module has one builder per way, and a run produces AT MOST ONE plan:
 *
 *  - `buildPiModelConfigPlan` registers a whole CUSTOM PROVIDER — a managed OpenAI-compatible
 *    connection becomes a provider named after its connection slug, so pi-acp advertises
 *    `<slug>/<model-id>`. Every model on such a connection is unknown to Pi by definition.
 *  - `buildPiModelRegistrationPlan` merges ONE model into a provider Pi already has built in.
 *    Pi's registry is a static table, so a model id an author typed by hand (an OpenRouter
 *    routing variant such as `deepseek/deepseek-v4-flash:nitro`, or a model newer than the pinned
 *    Pi) is not in it and the session refuses to select it. Pi's documented merge semantics for a
 *    built-in provider keep every built-in model and upsert the custom one, so this registers the
 *    requested model and nothing else.
 *
 * The input stays neutral in both cases — no Pi-specific wire field is introduced.
 */
import type { AgentRunRequest } from "../../protocol.ts";
import { harnessKindOf } from "../../harness-kind.ts";
import type {
  PiBuiltinModel,
  PiBuiltinRegistry,
} from "./pi-builtin-registry.ts";

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
 * One model entry in a `models.json` provider block, in Pi's own spelling. Everything but `id` is
 * optional: Pi fills its own defaults for whatever is absent.
 */
export interface PiModelEntry {
  id: string;
  api?: string;
  compat?: Record<string, unknown>;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  cost?: Record<string, unknown>;
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * A plan to merge one model into a provider Pi ALREADY HAS BUILT IN — the hand-entered-model case.
 *
 * Deliberately carries no `baseUrl`, `api`, or `apiKey`: for a built-in provider Pi inherits all
 * three from its own definitions (endpoint and dialect from the provider's built-in models, the
 * key from the same env var the provider's catalog models already authenticate with). Emitting
 * `baseUrl` or a provider-level `compat` would additionally re-point EVERY built-in model on that
 * provider, which is a much larger change than registering one id. Per-model metadata therefore
 * rides on the entry itself.
 */
export interface PiModelRegistrationPlan {
  /** A Pi BUILT-IN provider id (e.g. `openrouter`), taken from the requested model's prefix. */
  builtinProvider: string;
  /** The one model being registered. */
  models: [PiModelEntry];
}

/** The two shapes a run's `models.json` can take. A run produces at most one. */
export type PiModelsJsonPlan = PiModelConfigPlan | PiModelRegistrationPlan;

/** Narrow a plan to the built-in-provider merge (the other shape registers a custom provider). */
export function isPiModelRegistrationPlan(
  plan: PiModelsJsonPlan,
): plan is PiModelRegistrationPlan {
  return "builtinProvider" in plan;
}

/** The Pi provider id a plan registers under — the `<provider>` half of `<provider>/<model>`. */
export function piModelsJsonProviderId(plan: PiModelsJsonPlan): string {
  return isPiModelRegistrationPlan(plan)
    ? plan.builtinProvider
    : plan.providerId;
}

/** One-line description of a plan for run logs. Carries ids only, never a credential. */
export function describePiModelsJsonPlan(plan: PiModelsJsonPlan): string {
  const models = plan.models.map((model) => model.id).join(",");
  return isPiModelRegistrationPlan(plan)
    ? `kind=builtin-model-registration provider=${plan.builtinProvider} model=${models}`
    : `kind=custom-provider provider=${plan.providerId} api=${plan.api} model=${models}`;
}

/**
 * OpenRouter (and gateways like it) name a routing VARIANT of a model by suffixing the base id
 * with `:<variant>` — `:nitro` for throughput-optimized routing, `:free`, `:floor`, and so on. The
 * variant selects a route, not a different model, so when the base id IS in Pi's registry its
 * metadata (context window, reasoning support, pricing, request dialect) describes the variant
 * exactly. Recovering it beats falling back to Pi's generic defaults, which would tell the harness
 * a 1M-context reasoning model has a 128K window and cannot think.
 */
function variantBaseId(modelId: string): string | undefined {
  const separator = modelId.lastIndexOf(":");
  if (separator <= 0 || separator === modelId.length - 1) return undefined;
  return modelId.slice(0, separator);
}

/** Copy the metadata fields Pi accepts on a `models.json` entry off a built-in definition. */
function entryFromBuiltin(id: string, builtin: PiBuiltinModel): PiModelEntry {
  return {
    id,
    ...(builtin.compat ? { compat: builtin.compat } : {}),
    ...(builtin.reasoning !== undefined
      ? { reasoning: builtin.reasoning }
      : {}),
    ...(builtin.thinkingLevelMap
      ? { thinkingLevelMap: builtin.thinkingLevelMap }
      : {}),
    ...(builtin.input ? { input: builtin.input } : {}),
    ...(builtin.cost ? { cost: builtin.cost } : {}),
    ...(builtin.contextWindow !== undefined
      ? { contextWindow: builtin.contextWindow }
      : {}),
    ...(builtin.maxTokens !== undefined
      ? { maxTokens: builtin.maxTokens }
      : {}),
  };
}

/**
 * Plan the registration of a requested model that Pi's built-in registry does not carry.
 *
 * Returns `undefined` — register nothing — for every case that does not need it:
 *   - a non-Pi harness, or a request with no model (the harness default applies);
 *   - a bare model id with no `<provider>/` prefix (Pi's own suffix matching resolves those);
 *   - a provider prefix that is not one of Pi's built-ins (a custom connection slug is registered
 *     by `buildPiModelConfigPlan` instead, and an unknown prefix has no endpoint to reach);
 *   - a model the provider ALREADY has built in — the catalog case. Registering it would replace
 *     Pi's own definition (that is the documented merge rule) and downgrade its metadata, so a
 *     catalog model must produce no entry at all.
 *
 * Metadata comes from Pi's own table wherever it can: the routing-variant base model when there is
 * one, else the provider's request dialect (`compat`) from any built-in sibling so the call is
 * shaped the way that provider expects. What cannot be derived is simply left out and Pi defaults
 * it.
 */
export function buildPiModelRegistrationPlan(
  request: AgentRunRequest,
  registry: PiBuiltinRegistry,
): PiModelRegistrationPlan | undefined {
  if (!isPiHarness(request.harness)) return undefined;

  const requested = request.model?.trim();
  if (!requested) return undefined;

  const separator = requested.indexOf("/");
  if (separator <= 0) return undefined;
  const provider = requested.slice(0, separator);
  const modelId = requested.slice(separator + 1);
  if (!modelId || !registry.hasProvider(provider)) return undefined;

  const builtins = registry.models(provider);
  if (builtins.some((builtin) => builtin.id === modelId)) return undefined;

  const baseId = variantBaseId(modelId);
  const base = baseId
    ? builtins.find((builtin) => builtin.id === baseId)
    : undefined;
  if (base) {
    return {
      builtinProvider: provider,
      models: [entryFromBuiltin(modelId, base)],
    };
  }

  // No base model to inherit from: carry only the provider's request dialect, which is a property
  // of the endpoint rather than of any one model, so the call is at least shaped correctly.
  const sibling = builtins[0];
  return {
    builtinProvider: provider,
    models: [
      { id: modelId, ...(sibling?.compat ? { compat: sibling.compat } : {}) },
    ],
  };
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

/** Pi identity check: THE shared normalizer, so it can never drift from `buildRunPlan`. */
function isPiHarness(harness: string | undefined): boolean {
  return harnessKindOf(harness) === "pi";
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
 * Serialize a plan to the exact Pi `models.json` document. Only this plan's one provider block is
 * written — arbitrary existing providers are never merged into a run. Pretty printed with a
 * trailing newline.
 *
 * A custom-provider plan is keyed by connection slug and references its key as `$OPENAI_API_KEY`
 * (never the raw value). A registration plan is keyed by the BUILT-IN provider id and carries only
 * `models`, so Pi keeps that provider's built-in endpoint, dialect, credential, and every model it
 * already ships, and merely upserts the one requested id.
 */
export function serializePiModelsJson(plan: PiModelsJsonPlan): string {
  const block = isPiModelRegistrationPlan(plan)
    ? { models: plan.models }
    : {
        baseUrl: plan.baseUrl,
        api: plan.api,
        apiKey: `$${plan.apiKeyEnv}`,
        models: plan.models.map((model) => ({ id: model.id })),
      };
  const document = { providers: { [piModelsJsonProviderId(plan)]: block } };
  return `${JSON.stringify(document, null, 2)}\n`;
}
