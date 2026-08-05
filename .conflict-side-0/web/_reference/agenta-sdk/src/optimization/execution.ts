import type {LanguageModel} from "ai"

import type {Agenta} from "../index"

// ─── Execution mode types ───────────────────────────────────────────────────

export interface DirectMode {
    mode: "direct"
    model: LanguageModel
}

export interface AgentaMode {
    mode: "agenta"
    agenta: Agenta
    appSlug: string
    environmentSlug: string
    modelId: string
}

export type ExecutionMode = DirectMode | AgentaMode

export interface ExecutionParams {
    model?: LanguageModel
    agenta?: Agenta
    appSlug?: string
    environmentSlug?: string
    modelId?: string
}

const DEFAULT_MODEL_ID = "anthropic/claude-haiku-4.5"

/**
 * Resolve execution mode from function params.
 * If `agenta` is provided, use Agenta mode (auto-seeds + invokes).
 * Otherwise, require `model` for direct AI SDK calls.
 */
export function resolveExecution(params: ExecutionParams, defaultSlug: string): ExecutionMode {
    if (params.agenta) {
        return {
            mode: "agenta",
            agenta: params.agenta,
            appSlug: params.appSlug ?? defaultSlug,
            environmentSlug: params.environmentSlug ?? "production",
            modelId: params.modelId ?? DEFAULT_MODEL_ID,
        }
    }
    if (!params.model) {
        throw new Error(
            "Either `model` (for direct AI SDK) or `agenta` (for Agenta-backed) must be provided",
        )
    }
    return {mode: "direct", model: params.model}
}

// ─── Auto-seeding ───────────────────────────────────────────────────────────

// Track which apps have been verified/seeded to avoid repeated lookups
const seededApps = new Set<string>()

/**
 * Ensure an optimization prompt app exists in Agenta; seed it if not.
 *
 * Uses `prompts.push()` which handles create-or-update and deployment.
 */
export async function ensurePromptApp(
    agenta: Agenta,
    slug: string,
    displayName: string,
    systemPrompt: string,
    modelId: string,
    environmentSlug: string,
): Promise<void> {
    if (seededApps.has(slug)) return

    const existing = await agenta.applications.findBySlug(slug)
    if (existing) {
        seededApps.add(slug)
        return
    }

    await agenta.prompts.push({
        slug,
        name: displayName,
        content: systemPrompt,
        userMessageTemplate: "{{user_prompt}}",
        inputKeys: ["user_prompt"],
        model: modelId,
        environment: environmentSlug,
    })

    seededApps.add(slug)
}

// ─── Response parsing ───────────────────────────────────────────────────────

/**
 * Parse a string response from Agenta into a typed object.
 * Agenta returns the LLM's text output as `data` — we parse it as JSON.
 */
export function parseAgentaResponse<T>(data: unknown): T {
    if (typeof data === "string") {
        const cleaned = data
            .replace(/^```(?:json)?\s*\n?/i, "")
            .replace(/\n?```\s*$/i, "")
            .trim()
        return JSON.parse(cleaned) as T
    }
    if (typeof data === "object" && data !== null) {
        if ("data" in data && typeof (data as Record<string, unknown>).data === "string") {
            return parseAgentaResponse<T>((data as Record<string, unknown>).data)
        }
        return data as T
    }
    throw new Error(`Unexpected Agenta response type: ${typeof data}`)
}
