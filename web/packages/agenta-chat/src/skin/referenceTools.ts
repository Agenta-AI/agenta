import type {ChatSkinRegistration, ToolDisplayEntry} from "./types"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * What an agent's revision `parameters` teach the tool-display registry about its own tools.
 *
 * A reference tool runs under the name the user gave it (`list-devto-articles`), which carries no
 * provenance: the resolver reads it as a bare platform name and the row gets the platform glyph.
 * The config knows which app it fronts, so each entry maps that name to its integration — enough
 * for the row to wear the app's logo. Wording stays name-derived: "Checked devto articles" reads
 * better than anything conjugated from `LIST_USER_ALL_ARTICLES`.
 */
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

export const referenceToolSkin = (parameters: unknown): ChatSkinRegistration => {
    const agent = isRecord(parameters) && isRecord(parameters.agent) ? parameters.agent : parameters
    const tools = isRecord(agent) && Array.isArray(agent.tools) ? agent.tools : []
    const toolDisplay: Record<string, ToolDisplayEntry> = {}
    const appHints = new Set<string>()
    for (const tool of tools) {
        if (!isRecord(tool)) continue
        // A per-action tool names its app outright.
        if (tool.type === "gateway") {
            const name = str(tool.name)
            const slug = str(tool.integration)
            if (!name || !slug) continue
            toolDisplay[name] = {kind: "gateway", app: () => ({slug})}
            appHints.add(slug)
        }
        // A whole-app connection only says which apps are around; a tool named after one of them
        // (from an earlier config, or one the model coined) is read as that app's.
        if (tool.type === "gateway_connection") {
            const slug = str(isRecord(tool.connection) ? tool.connection.integration : undefined)
            if (slug) appHints.add(slug)
        }
    }
    return {toolDisplay, appHints: [...appHints]}
}
