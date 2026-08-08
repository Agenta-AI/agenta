/**
 * agentConfigPatch — set an agent template's model, harness, or permission policy from OUTSIDE the
 * config drawer.
 *
 * The chat composer's `/model`, `/harness`, and `/permissions` commands write through these. Same contract as
 * `toolPermission`'s `withToolPermission`: pure, `parameters`-in / `parameters`-out, and located
 * via `locateTemplate` so the write lands exactly where `buildAgentRequest` reads from (the run
 * reads the draft config, so the change takes effect on the next send without a commit).
 *
 * The drawer's own writer is `useModelHarness`; these mirror its two writes (`llm` via
 * `composeModelValue`, `harness.kind` via a section replace) without its React state.
 */
import {composeModelValue, connectionFromConfig, type ConnectionMode} from "./connectionUtils"
import {isPermissionPolicy, type PermissionPolicy} from "./permissionPolicy"
import {locateTemplate} from "./toolPermission"

const isRecord = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v))

export interface ModelPatch {
    modelId: string
    provider: string | null
    /** Defaults to the stored connection's mode. */
    mode?: ConnectionMode
    /** Defaults to the stored connection's slug. */
    slug?: string | null
}

/**
 * Set `agent.llm` to a new ModelRef. The stored connection (mode + slug) and any extra keys on the
 * prior ref ride through unless the patch overrides them — a model swap must not silently drop a
 * named vault connection or the raw-JSON `extras` hatch.
 */
export function withModel(parameters: unknown, patch: ModelPatch): Record<string, unknown> | null {
    if (!isRecord(parameters) || !patch.modelId) return null
    const {template, wrap} = locateTemplate(parameters)
    const existing = template.llm
    const stored = connectionFromConfig(existing)
    return wrap({
        ...template,
        llm: composeModelValue({
            modelId: patch.modelId,
            provider: patch.provider,
            mode: patch.mode ?? stored.mode,
            slug: patch.slug !== undefined ? patch.slug : stored.slug,
            existing,
        }),
    })
}

/**
 * Set `agent.harness.kind`, preserving the rest of the harness section (notably `permissions`).
 * Does NOT touch the model — an unreachable model is the caller's call to make, since the chat
 * moves it to a fallback while the drawer only flags it.
 */
export function withHarnessKind(parameters: unknown, kind: string): Record<string, unknown> | null {
    if (!isRecord(parameters) || !kind) return null
    const {template, wrap} = locateTemplate(parameters)
    const harness = isRecord(template.harness) ? template.harness : {}
    return wrap({...template, harness: {...harness, kind}})
}

/**
 * Set `agent.runner.permissions.default`. The rules list beside it rides through untouched — the
 * palette picks a policy, rule editing stays in the config drawer.
 */
export function withRunnerPermission(
    parameters: unknown,
    policy: string,
): Record<string, unknown> | null {
    if (!isRecord(parameters) || !isPermissionPolicy(policy)) return null
    const {template, wrap} = locateTemplate(parameters)
    const runner = isRecord(template.runner) ? template.runner : {}
    const permissions = isRecord(runner.permissions) ? runner.permissions : {}
    return wrap({...template, runner: {...runner, permissions: {...permissions, default: policy}}})
}

/** The stored default policy, or null when the template names none. */
export function readRunnerPermission(parameters: unknown): PermissionPolicy | null {
    if (!isRecord(parameters)) return null
    const runner = locateTemplate(parameters).template.runner
    if (!isRecord(runner) || !isRecord(runner.permissions)) return null
    const stored = runner.permissions.default
    return isPermissionPolicy(stored) ? stored : null
}

/** The stored model id, or null. Reads the ModelRef the same way the picker does. */
export function readModelId(parameters: unknown): string | null {
    if (!isRecord(parameters)) return null
    const llm = locateTemplate(parameters).template.llm
    if (typeof llm === "string") return llm || null
    if (isRecord(llm)) return typeof llm.model === "string" && llm.model ? llm.model : null
    return null
}

/**
 * The template's configured tools, MCP servers, and skills. Empty arrays when the template has
 * none, so a caller can map straight over them.
 */
export function readAgentItems(parameters: unknown): {
    tools: unknown[]
    mcps: unknown[]
    skills: unknown[]
} {
    const empty = {tools: [], mcps: [], skills: []}
    if (!isRecord(parameters)) return empty
    const {template} = locateTemplate(parameters)
    const list = (value: unknown) => (Array.isArray(value) ? value : [])
    return {
        tools: list(template.tools),
        mcps: list(template.mcps),
        skills: list(template.skills),
    }
}

/** The stored harness kind, or null. */
export function readHarnessKind(parameters: unknown): string | null {
    if (!isRecord(parameters)) return null
    const harness = locateTemplate(parameters).template.harness
    if (!isRecord(harness)) return null
    return typeof harness.kind === "string" && harness.kind ? harness.kind : null
}
