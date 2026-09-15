import type {ChatSkinRegistration, ToolDisplayEntry} from "./types"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

// A reference tool runs under the user's name for it; the revision knows which app it fronts.
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
        // A whole-app connection: a tool named after the app is read as its own.
        if (tool.type === "gateway_connection") {
            const slug = str(isRecord(tool.connection) ? tool.connection.integration : undefined)
            if (slug) appHints.add(slug)
        }
    }
    return {toolDisplay, appHints: [...appHints]}
}
