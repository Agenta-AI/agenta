/**
 * Agenta SDK — Tool Definition Sync.
 *
 * Persists the agent's actual tool definitions (name, description, inputSchema)
 * to the Agenta revision's `parameters.prompt.llm_config.tools`. This ensures
 * the revision always reflects what the agent can actually do — closing the gap
 * between code-defined tools and what Agenta (and the optimization wizard) sees.
 *
 * Sync happens once per process per tool fingerprint. If tools haven't changed,
 * it's a no-op after the first check.
 */

import type {Agenta} from "@agenta/sdk"
import type {ToolSet} from "ai"
import {createHash} from "crypto"

// ─── Types ──────────────────────────────────────────────────────────────────

interface ToolDef {
    type: "function"
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

// ─── Process-level cache ────────────────────────────────────────────────────

/**
 * Cache of fingerprints per app. Once a fingerprint is synced,
 * we don't re-check until the process restarts or tools change.
 */
const syncedFingerprints = new Map<string, string>()

// ─── Extract tool definitions from AI SDK ToolSet ───────────────────────────

/**
 * Convert an AI SDK ToolSet into Agenta's PromptToolDef format.
 * Extracts name, description, and inputSchema (JSON Schema) from each tool.
 */
function extractToolDefs(tools: ToolSet): ToolDef[] {
    const defs: ToolDef[] = []
    for (const [name, tool] of Object.entries(tools)) {
        if (!tool || typeof tool !== "object") continue

        const t = tool as {
            description?: string
            inputSchema?: unknown
            parameters?: unknown
        }

        // AI SDK v6 uses inputSchema, v5 used parameters
        const schema = t.inputSchema ?? t.parameters
        const jsonSchema =
            schema &&
            typeof schema === "object" &&
            "jsonSchema" in (schema as Record<string, unknown>)
                ? (schema as {jsonSchema: Record<string, unknown>}).jsonSchema
                : (schema as Record<string, unknown> | undefined)

        defs.push({
            type: "function",
            function: {
                name,
                description: t.description ?? "",
                parameters: jsonSchema ?? {type: "object", properties: {}},
            },
        })
    }

    // Sort by name for stable fingerprinting
    defs.sort((a, b) => a.function.name.localeCompare(b.function.name))
    return defs
}

// ─── Fingerprint ────────────────────────────────────────────────────────────

function fingerprint(defs: ToolDef[]): string {
    const content = JSON.stringify(defs)
    return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

// ─── Sync ───────────────────────────────────────────────────────────────────

/**
 * Sync tool definitions to the Agenta revision.
 *
 * On the first call per process (or when tools change), fetches the latest
 * revision, compares tool fingerprints, and commits a new revision if they
 * differ. Subsequent calls with the same tools are no-ops.
 *
 * Designed to be fire-and-forget — runs in the background, never blocks
 * the agent, never throws.
 *
 * @param client - Agenta SDK client
 * @param tools - The merged ToolSet (after Agenta schema overrides)
 * @param appSlug - Application slug to resolve the workflow
 */
export async function syncToolDefinitions(
    client: Agenta,
    tools: ToolSet,
    appSlug: string,
): Promise<void> {
    try {
        const defs = extractToolDefs(tools)
        if (defs.length === 0) return

        const fp = fingerprint(defs)

        // Already synced this exact set of tools in this process
        if (syncedFingerprints.get(appSlug) === fp) return

        // Resolve the app and its latest revision
        const app = await client.workflows.findBySlug(appSlug, {is_application: true})
        if (!app?.id) {
            syncedFingerprints.set(appSlug, fp)
            return
        }

        const revision = await client.workflows.fetchLatest(app.id)
        if (!revision?.id || !revision.data) {
            syncedFingerprints.set(appSlug, fp)
            return
        }

        // Compare with what's in the revision
        const revData = revision.data as Record<string, unknown>
        const params = revData?.parameters as Record<string, unknown> | undefined
        const prompt = params?.prompt as Record<string, unknown> | undefined
        const llmConfig = prompt?.llm_config as Record<string, unknown> | undefined
        const existingTools = llmConfig?.tools as ToolDef[] | undefined

        const existingFp = existingTools
            ? fingerprint(
                  [...existingTools].sort((a, b) =>
                      (a.function?.name ?? "").localeCompare(b.function?.name ?? ""),
                  ),
              )
            : ""

        if (existingFp === fp) {
            // Tools already match — cache and skip
            syncedFingerprints.set(appSlug, fp)
            return
        }

        // Tools differ — commit a new revision with updated tools
        const newData = JSON.parse(JSON.stringify(revData))
        if (!newData.parameters) newData.parameters = {}
        if (!newData.parameters.prompt) newData.parameters.prompt = {}
        if (!newData.parameters.prompt.llm_config) newData.parameters.prompt.llm_config = {}
        newData.parameters.prompt.llm_config.tools = defs

        // Also update the schema default if it exists
        const schemaPropPrompt = newData?.schemas?.parameters?.properties?.prompt
        if (schemaPropPrompt?.default?.llm_config) {
            schemaPropPrompt.default.llm_config.tools = defs
        }

        await client.workflows.commitRevision({
            workflowId: app.id,
            variantId: revision.workflow_variant_id,
            data: newData,
            message: `Sync ${defs.length} tool definitions from code`,
        })

        syncedFingerprints.set(appSlug, fp)
    } catch {
        // Non-fatal — tool sync failure shouldn't break the agent.
        // Don't cache on error so we retry next time.
    }
}
