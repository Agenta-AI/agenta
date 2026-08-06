/**
 * Agenta SDK — AI SDK Adapter: Agent Builder with Prompts.
 *
 * Creates a ToolLoopAgent with instructions composed from Agenta's prompt
 * registry, tool schemas merged from Agenta, and telemetry pre-configured.
 *
 * ```ts
 * import { createAgentWithPrompts } from "@agenta/sdk/ai";
 *
 * const agent = await createAgentWithPrompts({
 *   model: getModel(),
 *   promptSlugs: ["rh-voice", "rh-onboarding", "rh-workflow"],
 *   environment: "development",
 *   tools: myLocalTools,
 *   fallbacks: localFallbacks,
 * });
 * ```
 */

import {ToolLoopAgent, tool as defineTool, jsonSchema} from "ai"
import type {ToolSet, LanguageModel, StopCondition} from "ai"
import {Agenta} from "@agenta/sdk"
import type {ToolSchema} from "@agenta/sdk/prompts"
import {setAgentaContext} from "./agent-context"
import {syncToolDefinitions} from "./sync-tools"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateAgentWithPromptsOptions {
    /** The LLM model to use */
    model: LanguageModel
    /** Agenta application slug (primary app for telemetry). Default: first slug in promptSlugs */
    applicationSlug?: string
    /** Prompt module slugs to compose, in order */
    promptSlugs?: string[]
    /** Environment to fetch from. Default: "development" */
    environment?: string
    /** Local tools — SDK merges Agenta-managed schemas on top */
    tools?: ToolSet
    /** Local fallback prompt content per slug */
    fallbacks?: Record<string, string>
    /** Dynamic sections appended to instructions */
    dynamicSections?: Record<string, string>
    /** Template variable interpolation */
    templateVars?: Record<string, string>
    /** Stop condition. Default: stepCountIs(15) */
    stopWhen?: StopCondition<ToolSet>
    /** Agenta SDK client (creates one if not provided) */
    agenta?: Agenta
    /** Enable telemetry. Default: true if AGENTA_API_KEY is set */
    telemetry?: boolean
    /** Additional telemetry metadata */
    telemetryMetadata?: Record<string, string>
}

// ─── Tool Schema Merging ─────────────────────────────────────────────────────

/**
 * Override local tool descriptions and schemas with Agenta-managed versions.
 * Agenta controls what the LLM sees (description, parameter schema).
 * Local code controls what happens (execute function).
 */
function mergeToolSchemas(
    localTools: Record<string, unknown>,
    agentaSchemas: Record<string, ToolSchema>,
): Record<string, unknown> {
    if (Object.keys(agentaSchemas).length === 0) return localTools

    const merged: Record<string, unknown> = {}
    for (const [name, localTool] of Object.entries(localTools)) {
        const schema = agentaSchemas[name]
        if (!schema || !localTool || typeof localTool !== "object") {
            merged[name] = localTool
            continue
        }

        const lt = localTool as {
            description?: string
            inputSchema?: unknown
            execute?: (...args: unknown[]) => unknown
        }

        if (lt.execute) {
            merged[name] = defineTool({
                description: schema.description,
                inputSchema: jsonSchema(schema.parameters),
                execute: lt.execute as (input: unknown) => Promise<unknown>,
            })
        } else {
            merged[name] = defineTool({
                description: schema.description,
                inputSchema: jsonSchema(schema.parameters),
            })
        }
    }
    return merged
}

// ─── Agent Builder ───────────────────────────────────────────────────────────

/**
 * Create a ToolLoopAgent with Agenta-managed prompts and tool schemas.
 *
 * One function replaces the manual orchestration of:
 * - composeInstructions()
 * - fetchToolSchemas()
 * - getApplicationRefs()
 * - mergeAgentaSchemas()
 * - ToolLoopAgent constructor with telemetry config
 */
export async function createAgentWithPrompts(
    options: CreateAgentWithPromptsOptions,
): Promise<ToolLoopAgent> {
    const {
        model,
        applicationSlug,
        promptSlugs = [],
        environment = "development",
        tools: localTools = {},
        fallbacks = {},
        dynamicSections,
        templateVars,
        stopWhen,
        telemetry,
        telemetryMetadata = {},
    } = options

    const ag = options.agenta ?? new Agenta()

    // Fetch prompts + tool schemas from the registry
    const result = await ag.prompts.fetch({
        slugs: promptSlugs,
        environment,
        fallbacks,
        dynamicSections,
        templateVars,
    })

    // Merge local tools with Agenta-managed schemas
    const mergedTools = mergeToolSchemas(
        localTools as Record<string, unknown>,
        result.toolSchemas,
    ) as ToolSet

    // Resolve application refs for telemetry
    const appSlug = applicationSlug ?? promptSlugs[0]
    let appId = result.applicationId
    let revId = result.revisionId
    if (appSlug && !appId) {
        const refs = await ag.prompts.getApplicationRefs(appSlug, environment)
        appId = refs.applicationId
        revId = refs.revisionId
    }

    const isEnabled = telemetry ?? !!process.env.AGENTA_API_KEY

    const agent = new ToolLoopAgent({
        model,
        instructions: result.instructions,
        tools: mergedTools,
        ...(stopWhen ? {stopWhen} : {}),
        experimental_telemetry: {
            isEnabled,
            functionId: appSlug ?? "agenta-agent",
            recordInputs: true,
            recordOutputs: true,
            metadata: {
                ...telemetryMetadata,
                ...(appId ? {applicationId: appId} : {}),
                ...(revId ? {applicationRevisionId: revId} : {}),
            },
        },
    })

    // Attach Agenta context via WeakMap so createAgentaTracedResponse can
    // infer applicationSlug without the consumer passing it again.
    setAgentaContext(agent, {
        applicationSlug: appSlug,
        applicationId: appId ?? undefined,
        applicationRevisionId: revId ?? undefined,
        environment,
    })

    // Fire-and-forget: sync tool definitions to the Agenta revision.
    // Runs in the background — no-op if tools haven't changed since last sync.
    // This ensures the revision always reflects the agent's actual capabilities.
    if (appSlug && isEnabled) {
        syncToolDefinitions(ag, mergedTools, appSlug).catch(() => {})
    }

    return agent
}
