/**
 * Agenta SDK — Mastra Adapter: Prompt Config Fetcher.
 *
 * Fetches prompt configuration from Agenta's registry for Mastra users.
 * Returns raw config that consumers wire into Mastra's agent builder.
 *
 * ```ts
 * import { getMastraPromptConfig } from "@agenta/sdk/mastra";
 *
 * const config = await getMastraPromptConfig({
 *   promptSlugs: ["rh-voice", "rh-onboarding"],
 *   environment: "development",
 * });
 *
 * const agent = new Agent({
 *   instructions: config.instructions,
 *   model: myModel,
 * });
 * ```
 */

import {Agenta} from "@agenta/sdk"
import type {ToolSchema} from "@agenta/sdk/prompts"

export interface MastraPromptConfigOptions {
    /** Agenta application slug (primary app for telemetry) */
    applicationSlug?: string
    /** Prompt module slugs to compose, in order */
    promptSlugs?: string[]
    /** Environment to fetch from. Default: "development" */
    environment?: string
    /** Local fallback prompt content per slug */
    fallbacks?: Record<string, string>
    /** Dynamic sections appended to instructions */
    dynamicSections?: Record<string, string>
    /** Template variable interpolation */
    templateVars?: Record<string, string>
    /** Agenta SDK client (creates one if not provided) */
    agenta?: Agenta
}

export interface MastraPromptConfig {
    /** Composed instructions (all slugs joined) */
    instructions: string
    /** Tool schemas from the prompt registry */
    toolSchemas: Record<string, ToolSchema>
    /** Application ID for telemetry */
    applicationId: string | null
    /** Revision ID for telemetry */
    revisionId: string | null
    /** Revision IDs per slug */
    revisionIds: Record<string, string>
    /** Source: "environment", "latest", or "fallback" */
    source: string
}

/**
 * Fetch prompt configuration from Agenta for use with Mastra.
 *
 * Returns the raw config — consumers wire it into Mastra's agent builder.
 * Unlike the AI SDK adapter, this doesn't create an agent — Mastra users
 * have their own agent construction patterns.
 */
export async function getMastraPromptConfig(
    options: MastraPromptConfigOptions,
): Promise<MastraPromptConfig> {
    const {
        applicationSlug,
        promptSlugs = [],
        environment = "development",
        fallbacks = {},
        dynamicSections,
        templateVars,
    } = options

    const ag = options.agenta ?? new Agenta()

    const result = await ag.prompts.fetch({
        slugs: promptSlugs,
        environment,
        fallbacks,
        dynamicSections,
        templateVars,
    })

    // Resolve application refs if needed
    const appSlug = applicationSlug ?? promptSlugs[0]
    let appId = result.applicationId
    let revId = result.revisionId
    if (appSlug && !appId) {
        const refs = await ag.prompts.getApplicationRefs(appSlug, environment)
        appId = refs.applicationId
        revId = refs.revisionId
    }

    return {
        instructions: result.instructions,
        toolSchemas: result.toolSchemas,
        applicationId: appId,
        revisionId: revId,
        revisionIds: result.revisionIds,
        source: result.source,
    }
}
