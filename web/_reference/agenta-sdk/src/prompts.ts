/**
 * Agenta SDK — Prompt Registry Manager.
 *
 * Fetches prompts from Agenta's registry with environment-based deployment
 * support, caching, and fallbacks.
 *
 * Usage:
 * ```ts
 * const ag = new Agenta();
 * const result = await ag.prompts.fetch({
 *   slugs: ["rh-voice", "rh-onboarding"],
 *   environment: "development",
 *   fallbacks: { "rh-voice": "local fallback text" },
 * });
 *
 * result.instructions   // composed prompt string
 * result.toolSchemas    // Record<toolName, { description, parameters }>
 * result.revisionIds    // Record<slug, revisionId>
 * result.applicationId  // first app's ID (for telemetry)
 * ```
 */

import {z} from "zod"

import {Applications} from "./applications"
import type {AgentaClient} from "./client"
import {Environments} from "./environments"
import {Revisions} from "./revisions"
import type {ApplicationRevisionData} from "./types"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolSchema {
    description: string
    parameters: Record<string, unknown>
}

// ─── Zod Schemas (validate external data + return shape) ─────────────────────

/**
 * Schema for the revision parameters we read prompt content from. Matches
 * `PromptTemplateInternal` below and the chat:v0 prompt shape.
 *
 * Used as a defensive `safeParse` at the API boundary — drift logs a warning
 * but doesn't break the call. The fallback path in `fetch()` handles missing
 * data gracefully.
 */
const PromptTemplateInternalSchema = z.object({
    messages: z.array(z.object({role: z.string(), content: z.string()})).optional(),
    template_format: z.string().optional(),
    input_keys: z.array(z.string()).optional(),
    llm_config: z
        .object({
            model: z.string().optional(),
            tools: z
                .array(
                    z.object({
                        type: z.literal("function"),
                        function: z.object({
                            name: z.string(),
                            description: z.string().default(""),
                            parameters: z.record(z.string(), z.unknown()),
                        }),
                    }),
                )
                .optional(),
        })
        .optional(),
})

const ToolSchemaShape = z.object({
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
})

/**
 * Schema for `PromptFetchResult` — validates the assembled return value.
 * Used as a strict `parse` at the function boundary; a failure here is a
 * bug in our composition logic, not external drift.
 */
const PromptFetchResultSchema = z.object({
    instructions: z.string(),
    toolSchemas: z.record(z.string(), ToolSchemaShape),
    revisionIds: z.record(z.string(), z.string()),
    applicationId: z.string().nullable(),
    revisionId: z.string().nullable(),
    source: z.enum(["environment", "latest", "fallback"]),
})

export interface PromptFetchOptions {
    /** Prompt module slugs to fetch, in composition order */
    slugs: string[]
    /** Environment to fetch from. Default: "development" */
    environment?: string
    /** Local fallback content per slug (used when Agenta is unreachable) */
    fallbacks?: Record<string, string>
    /** Dynamic sections appended after all modules (e.g., integration context) */
    dynamicSections?: Record<string, string>
    /** Template variable interpolation: {{key}} → value */
    templateVars?: Record<string, string>
    /** Cache TTL in milliseconds. Default: 60000 (1 minute) */
    cacheTtlMs?: number
}

export interface PromptFetchResult {
    /** Composed instructions (all slugs joined with double newlines) */
    instructions: string
    /** Tool schemas extracted from prompt apps' llm_config.tools */
    toolSchemas: Record<string, ToolSchema>
    /** Revision ID per slug (for the fetched revision) */
    revisionIds: Record<string, string>
    /** First matched application ID (for telemetry tagging) */
    applicationId: string | null
    /** First matched revision ID (for telemetry tagging) */
    revisionId: string | null
    /** Source: "environment", "latest", or "fallback" */
    source: "environment" | "latest" | "fallback"
}

export interface PromptModule {
    slug: string
    name: string
    description?: string
    content: string
    tools?: PromptToolDef[]
}

interface PromptToolDef {
    type: "function"
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

export interface PromptPushOptions {
    /** Unique slug for this prompt (used as the Agenta app slug) */
    slug: string
    /** Display name */
    name: string
    /** The prompt content (system message text) */
    content: string
    /** Optional description */
    description?: string
    /** Optional tool definitions to include in the prompt */
    tools?: PromptToolDef[]
    /** Model ID in LiteLLM format. Default: "anthropic/claude-haiku-4-5" */
    model?: string
    /** Environment to deploy to. Default: "development" */
    environment?: string
    /** Optional user message template (e.g. "{{user_prompt}}") for template-driven prompts */
    userMessageTemplate?: string
    /** Template variable names used in the prompt (e.g. ["user_prompt"]) */
    inputKeys?: string[]
}

export interface PromptPushResult {
    applicationId: string
    revisionId: string | null
    deployed: boolean
    environment: string | null
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry {
    prompts: Record<string, string>
    toolSchemas: Record<string, ToolSchema>
    revisionIds: Record<string, string>
    applicationId: string | null
    time: number
}

// ─── Manager ─────────────────────────────────────────────────────────────────

export class Prompts {
    private client: AgentaClient
    private applications: Applications
    private revisions: Revisions
    private environments: Environments
    private cache: CacheEntry | null = null
    private chatTemplateData: ApplicationRevisionData | null | undefined

    constructor(
        client: AgentaClient,
        applications: Applications,
        revisions: Revisions,
        environments: Environments,
    ) {
        this.client = client
        this.applications = applications
        this.revisions = revisions
        this.environments = environments
    }

    /**
     * Fetch prompts from the registry.
     *
     * Resolution order:
     * 1. Cache (if not expired)
     * 2. Environment deployment (if environment specified)
     * 3. Latest revisions (fallback)
     * 4. Local fallbacks (if Agenta unreachable)
     */
    async fetch(options: PromptFetchOptions): Promise<PromptFetchResult> {
        const {
            slugs,
            environment = "development",
            fallbacks = {},
            dynamicSections,
            templateVars,
            cacheTtlMs = 60_000,
        } = options

        // Check cache
        const now = Date.now()
        if (this.cache && now - this.cache.time < cacheTtlMs) {
            return this.validateFetchResult(
                this.composeResult(
                    slugs,
                    this.cache,
                    fallbacks,
                    dynamicSections,
                    templateVars,
                    this.cache.applicationId ? "environment" : "latest",
                ),
            )
        }

        // Try environment-based fetch
        const envResult = await this.fetchFromEnvironment(environment)
        if (envResult) {
            this.cache = {...envResult, time: now}
            return this.validateFetchResult(
                this.composeResult(
                    slugs,
                    envResult,
                    fallbacks,
                    dynamicSections,
                    templateVars,
                    "environment",
                ),
            )
        }

        // Fallback: fetch latest revisions
        const latestResult = await this.fetchLatest()
        if (latestResult && Object.keys(latestResult.prompts).length > 0) {
            this.cache = {...latestResult, time: now}
            return this.validateFetchResult(
                this.composeResult(
                    slugs,
                    latestResult,
                    fallbacks,
                    dynamicSections,
                    templateVars,
                    "latest",
                ),
            )
        }

        // All failed — use fallbacks only
        return this.validateFetchResult(
            this.composeResult(
                slugs,
                {prompts: {}, toolSchemas: {}, revisionIds: {}, applicationId: null},
                fallbacks,
                dynamicSections,
                templateVars,
                "fallback",
            ),
        )
    }

    /**
     * Validate a composed `PromptFetchResult` against its Zod schema.
     * Throws on internal composition drift. Use only at function-boundary
     * exits, not on external data.
     */
    private validateFetchResult(result: PromptFetchResult): PromptFetchResult {
        return PromptFetchResultSchema.parse(result) as PromptFetchResult
    }

    /**
     * Fetch a single prompt module.
     */
    async fetchOne(
        slug: string,
        options?: {environment?: string; fallback?: string},
    ): Promise<{content: string; revisionId: string | null}> {
        const result = await this.fetch({
            slugs: [slug],
            environment: options?.environment,
            fallbacks: options?.fallback ? {[slug]: options.fallback} : {},
        })
        return {
            content: result.instructions,
            revisionId: result.revisionIds[slug] ?? null,
        }
    }

    /**
     * Get application + revision IDs for telemetry tagging.
     */
    async getApplicationRefs(
        slug: string,
        environment = "development",
    ): Promise<{applicationId: string | null; revisionId: string | null}> {
        // Try environment resolution first
        try {
            const resolved = (await this.environments.resolve({
                environmentRef: {slug: environment},
            })) as Record<string, unknown>

            const envRev = resolved.environment_revision as Record<string, unknown> | undefined
            const refs = (envRev?.data as Record<string, unknown> | undefined)?.references as
                | Record<string, Record<string, {id?: string}>>
                | undefined
            const appRef = refs?.[`${slug}.revision`]

            if (appRef?.application_revision?.id) {
                const app = await this.applications.findBySlug(slug)
                return {
                    applicationId: app?.id ?? null,
                    revisionId: appRef.application_revision.id,
                }
            }
        } catch {
            /* fall through */
        }

        // Fallback to latest
        try {
            const app = await this.applications.findBySlug(slug)
            return {
                applicationId: app?.id ?? null,
                revisionId: app?.revision_id ?? null,
            }
        } catch {
            return {applicationId: null, revisionId: null}
        }
    }

    /**
     * Clear the prompt cache (forces re-fetch on next call).
     */
    clearCache(): void {
        this.cache = null
    }

    // ─── Push: Migrate Existing Prompts to Agenta ──────────────────────────────

    /**
     * Push a prompt to Agenta and deploy it to an environment.
     *
     * Creates the application if it doesn't exist, updates it if it does.
     * Automatically deploys to the specified environment.
     *
     * This is the migration entry point — take an existing prompt string
     * and register it in Agenta in one call.
     *
     * ```ts
     * await ag.prompts.push({
     *   slug: "my-system-prompt",
     *   name: "System Prompt",
     *   content: "You are a helpful assistant...",
     *   environment: "development",
     * });
     * ```
     */
    async push(options: PromptPushOptions): Promise<PromptPushResult> {
        const {
            slug,
            name,
            content,
            description,
            tools,
            model = "anthropic/claude-haiku-4-5",
            environment = "development",
            userMessageTemplate,
            inputKeys,
        } = options

        // Build the prompt template in Agenta's chat:v0 format
        const promptTemplate = buildPromptTemplate(content, model, tools, {
            userMessage: userMessageTemplate,
            inputKeys,
        })
        const templateData = await this.getChatTemplateData()
        const appData = buildChatV0Data(name, promptTemplate, templateData)

        // Create or update the application
        const existing = await this.applications.findBySlug(slug)
        let appId: string
        let revisionId: string | undefined
        let variantId: string | undefined

        if (existing?.id) {
            const res = await this.applications.update({
                id: existing.id,
                flags: {is_application: true, is_chat: true},
                data: {uri: "agenta:builtin:chat:v0", parameters: appData.parameters},
            })
            appId = existing.id
            revisionId = res.application?.revision_id
            variantId = res.application?.variant_id ?? existing.variant_id
        } else {
            const res = await this.applications.create({
                slug,
                name,
                description,
                flags: {is_application: true, is_chat: true},
                data: appData,
            })
            appId = res.application!.id!
            revisionId = res.application!.revision_id
            variantId = res.application!.variant_id
        }

        // Deploy to environment
        let deployed = false
        if (revisionId) {
            try {
                const env = await this.environments.ensureExists(environment, environment)
                if (env.id && env.variant_id) {
                    await this.environments.deploy({
                        environmentId: env.id,
                        environmentVariantId: env.variant_id,
                        appId,
                        appSlug: slug,
                        appVariantId: variantId,
                        appRevisionId: revisionId,
                        message: `Push: ${name}`,
                    })
                    deployed = true
                }
            } catch {
                // Deploy failed — app was created but not deployed
            }
        }

        // Clear cache so next fetch picks up the new prompt
        this.clearCache()

        return {
            applicationId: appId,
            revisionId: revisionId ?? null,
            deployed,
            environment: deployed ? environment : null,
        }
    }

    /**
     * Push multiple prompts to Agenta and deploy them to an environment.
     *
     * Convenience wrapper for migrating an entire prompt set at once.
     *
     * ```ts
     * await ag.prompts.pushMany([
     *   { slug: "system-prompt", name: "System", content: SYSTEM_PROMPT },
     *   { slug: "onboarding", name: "Onboarding", content: ONBOARDING },
     * ], { environment: "development" });
     * ```
     */
    async pushMany(
        prompts: PromptPushOptions[],
        options?: {environment?: string},
    ): Promise<PromptPushResult[]> {
        const results: PromptPushResult[] = []
        for (const prompt of prompts) {
            const result = await this.push({
                ...prompt,
                environment: prompt.environment ?? options?.environment ?? "development",
            })
            results.push(result)
        }
        return results
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    private async fetchFromEnvironment(
        environmentSlug: string,
    ): Promise<Omit<CacheEntry, "time"> | null> {
        try {
            const resolved = (await this.environments.resolve({
                environmentRef: {slug: environmentSlug},
            })) as Record<string, unknown>

            const envRevision = resolved.environment_revision as Record<string, unknown> | undefined
            const envData = envRevision?.data as Record<string, unknown> | undefined
            const references = envData?.references as
                | Record<string, Record<string, {id?: string; slug?: string}>>
                | undefined

            if (!references || Object.keys(references).length === 0) return null

            const prompts: Record<string, string> = {}
            const toolSchemas: Record<string, ToolSchema> = {}
            const revisionIds: Record<string, string> = {}
            let applicationId: string | null = null

            for (const [refKey, refs] of Object.entries(references)) {
                const appSlug = refKey.replace(/\.revision$/, "")
                const revisionId = refs.application_revision?.id
                if (!revisionId) continue

                try {
                    const revisionRes = await this.revisions.retrieve({
                        applicationRevisionRef: {id: revisionId},
                    })
                    const revision = revisionRes.application_revision
                    if (!revision?.data) continue

                    const text = extractPromptContent(revision.data)
                    if (text) prompts[appSlug] = text
                    revisionIds[appSlug] = revisionId

                    if (!applicationId && refs.application?.id) {
                        applicationId = refs.application.id
                    }

                    extractToolSchemas(revision.data, toolSchemas)
                } catch {
                    /* skip this revision */
                }
            }

            if (Object.keys(prompts).length === 0) return null
            return {prompts, toolSchemas, revisionIds, applicationId}
        } catch {
            return null
        }
    }

    private async fetchLatest(): Promise<Omit<CacheEntry, "time"> | null> {
        try {
            const apps = await this.applications.list()
            const promptApps = apps.filter((a) => a.slug?.startsWith("rh-"))

            const prompts: Record<string, string> = {}
            const toolSchemas: Record<string, ToolSchema> = {}
            const revisionIds: Record<string, string> = {}
            let applicationId: string | null = null

            for (const app of promptApps) {
                if (!app.slug) continue
                const text = extractPromptContent(app.data)
                if (text) prompts[app.slug] = text
                if (app.revision_id) revisionIds[app.slug] = app.revision_id
                if (!applicationId && app.id) applicationId = app.id

                extractToolSchemas(app.data, toolSchemas)
            }

            return {prompts, toolSchemas, revisionIds, applicationId}
        } catch {
            return null
        }
    }

    private composeResult(
        slugs: string[],
        cache: Omit<CacheEntry, "time">,
        fallbacks: Record<string, string>,
        dynamicSections: Record<string, string> | undefined,
        templateVars: Record<string, string> | undefined,
        source: "environment" | "latest" | "fallback",
    ): PromptFetchResult {
        const parts: string[] = []

        for (const slug of slugs) {
            let text = cache.prompts[slug] ?? fallbacks[slug] ?? ""
            if (text && templateVars) {
                for (const [key, value] of Object.entries(templateVars)) {
                    text = text.split(`{{${key}}}`).join(value)
                }
            }
            if (text) parts.push(text)
        }

        if (dynamicSections) {
            for (const value of Object.values(dynamicSections)) {
                if (value) parts.push(value)
            }
        }

        // Find first revision ID from the slugs (for telemetry)
        let firstRevisionId: string | null = null
        for (const slug of slugs) {
            if (cache.revisionIds[slug]) {
                firstRevisionId = cache.revisionIds[slug]
                break
            }
        }

        return {
            instructions: parts.join("\n\n"),
            toolSchemas: cache.toolSchemas,
            revisionIds: cache.revisionIds,
            applicationId: cache.applicationId,
            revisionId: firstRevisionId,
            source,
        }
    }

    private async getChatTemplateData(): Promise<ApplicationRevisionData | null> {
        if (this.chatTemplateData !== undefined) {
            return this.chatTemplateData
        }

        try {
            const res = await this.client.get<{
                templates?: {
                    key?: string
                    data?: ApplicationRevisionData
                }[]
            }>("/workflows/catalog/templates/", {
                params: {is_application: "true"},
            })

            const templates = res.templates ?? []
            const chatTemplate =
                templates.find((t) => t.key === "chat") ??
                templates.find((t) => t.data?.uri === "agenta:builtin:chat:v0")

            this.chatTemplateData = chatTemplate?.data ?? null
            return this.chatTemplateData
        } catch {
            this.chatTemplateData = null
            return null
        }
    }
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

interface PromptTemplateInternal {
    messages: {role: string; content: string}[]
    template_format: string
    input_keys: string[]
    llm_config: {
        model: string
        tools?: PromptToolDef[]
    }
}

/**
 * Validate the prompt template shape with Zod. Logs a one-line warning on
 * drift but returns the parsed-or-raw object so callers can keep going —
 * the consuming helpers use optional chaining throughout.
 */
function parsePromptTemplate(raw: unknown): PromptTemplateInternal | undefined {
    if (raw == null || typeof raw !== "object") return undefined
    const parsed = PromptTemplateInternalSchema.safeParse(raw)
    if (!parsed.success) {
        console.warn(
            "[@agenta/sdk] prompt template shape drifted from schema:",
            parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        )
        return raw as PromptTemplateInternal
    }
    return parsed.data as PromptTemplateInternal
}

/**
 * Extract system message content from prompt app data.
 * Handles both new format (prompt.messages) and legacy (prompt_text).
 */
function extractPromptContent(data?: ApplicationRevisionData): string | null {
    const params = data?.parameters as Record<string, unknown> | undefined
    const prompt = parsePromptTemplate(params?.prompt)

    if (prompt?.messages) {
        const systemMsg = prompt.messages.find((m) => m.role === "system")
        if (systemMsg?.content) return systemMsg.content
    }

    const legacyText = params?.prompt_text as string | undefined
    if (legacyText) return legacyText

    return null
}

/**
 * Extract tool schemas from prompt app data into the target map.
 */
function extractToolSchemas(
    data: ApplicationRevisionData | undefined,
    target: Record<string, ToolSchema>,
): void {
    const params = data?.parameters as Record<string, unknown> | undefined
    const prompt = parsePromptTemplate(params?.prompt)
    const tools = prompt?.llm_config?.tools
    if (!tools) return

    for (const t of tools) {
        if (t.type === "function" && t.function?.name) {
            target[t.function.name] = {
                description: t.function.description,
                parameters: t.function.parameters,
            }
        }
    }
}

// ─── Builders for Push ───────────────────────────────────────────────────────

function buildPromptTemplate(
    content: string,
    model: string,
    tools?: PromptToolDef[],
    options?: {userMessage?: string; inputKeys?: string[]},
): PromptTemplateInternal {
    const messages: {role: string; content: string}[] = [{role: "system", content}]
    if (options?.userMessage) {
        messages.push({role: "user", content: options.userMessage})
    }
    return {
        messages,
        template_format: "curly",
        input_keys: options?.inputKeys ?? [],
        llm_config: {
            model,
            ...(tools && tools.length > 0 ? {tools} : {}),
        },
    }
}

function buildChatV0Data(
    name: string,
    prompt: PromptTemplateInternal,
    templateData?: ApplicationRevisionData | null,
): ApplicationRevisionData {
    if (templateData) {
        const templateParameters =
            (templateData.schemas?.parameters as Record<string, unknown> | undefined) ?? {}
        const templateProperties =
            (templateParameters.properties as Record<string, unknown> | undefined) ?? {}
        const templatePromptProperty =
            (templateProperties.prompt as Record<string, unknown> | undefined) ?? {}

        return {
            ...templateData,
            schemas: {
                ...(templateData.schemas ?? {}),
                parameters: {
                    ...templateParameters,
                    title: (templateParameters.title as string | undefined) ?? `${name} Parameters`,
                    properties: {
                        ...templateProperties,
                        prompt: {
                            ...templatePromptProperty,
                            default: prompt,
                        },
                    },
                },
            },
            parameters: {
                ...((templateData.parameters as Record<string, unknown>) ?? {}),
                prompt,
            },
        }
    }

    return {
        uri: "agenta:builtin:chat:v0",
        url: "http://localhost/services/chat/v0",
        schemas: {
            parameters: {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                type: "object",
                properties: {
                    prompt: {
                        "x-ag-type": "prompt-template",
                        type: "object",
                        title: "PromptTemplate",
                        default: prompt,
                    },
                },
                additionalProperties: true,
                title: `${name} Parameters`,
            },
            outputs: {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                type: ["string", "object", "array"],
                title: "Chat App Outputs",
            },
        },
        parameters: {prompt},
    }
}
