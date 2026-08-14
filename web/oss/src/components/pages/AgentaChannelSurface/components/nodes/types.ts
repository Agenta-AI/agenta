/**
 * The design vocabulary: text, buttons, select, fields, table, image --
 * grouped multi-option nodes the API does not send today. It is the
 * reference definition this surface is meant to grow into. The live shape
 * (what the API actually emits) is below the `AgentaButtonRunNode` split.
 */

export interface AgentaChoiceOption {
    id: string
    label: string
}

export interface AgentaTextNode {
    type: "text"
    text: string
}

export interface AgentaButtonsNode {
    type: "buttons"
    options: AgentaChoiceOption[]
}

export interface AgentaSelectNode {
    type: "select"
    options: AgentaChoiceOption[]
}

export interface AgentaFieldsNode {
    type: "fields"
    fields: {label: string; value: string}[]
}

export interface AgentaTableNode {
    type: "table"
    columns: string[]
    rows: string[][]
}

export interface AgentaImageNode {
    type: "image"
    url: string
    caption?: string
}

// --- live shape: what `RenderPart` (api/core/channels/render/dtos.py) actually emits
// today -- text/button/card, one part per button, never a grouped choice. Everything
// above this line is ahead of the API.

export interface AgentaLiveButton {
    id?: string
    label: string
    value: string
}

export interface AgentaButtonRunNode {
    type: "button-run"
    buttons: AgentaLiveButton[]
}

export interface AgentaCardNode {
    type: "card"
    title?: string
    tool?: string
    arguments?: Record<string, unknown>
}

export type AgentaNode =
    | AgentaTextNode
    | AgentaButtonsNode
    | AgentaSelectNode
    | AgentaFieldsNode
    | AgentaTableNode
    | AgentaImageNode
    | AgentaButtonRunNode
    | AgentaCardNode

const isChoiceOption = (value: unknown): value is AgentaChoiceOption =>
    !!value &&
    typeof value === "object" &&
    typeof (value as any).id === "string" &&
    typeof (value as any).label === "string"

/** Best-effort parse of one `content` item into a typed node, or null if unrecognised. */
export function parseAgentaNode(value: unknown): AgentaNode | null {
    if (!value || typeof value !== "object") return null
    const item = value as Record<string, unknown>

    switch (item.type) {
        case "text":
            return typeof item.text === "string" ? {type: "text", text: item.text} : null
        case "buttons": {
            const options = Array.isArray(item.options) ? item.options.filter(isChoiceOption) : []
            return options.length ? {type: "buttons", options} : null
        }
        case "select": {
            const options = Array.isArray(item.options) ? item.options.filter(isChoiceOption) : []
            return options.length ? {type: "select", options} : null
        }
        case "fields": {
            const fields = Array.isArray(item.fields)
                ? item.fields.filter(
                      (f): f is {label: string; value: string} =>
                          !!f &&
                          typeof f === "object" &&
                          typeof (f as any).label === "string" &&
                          typeof (f as any).value === "string",
                  )
                : []
            return fields.length ? {type: "fields", fields} : null
        }
        case "table": {
            const columns = Array.isArray(item.columns)
                ? item.columns.filter((c): c is string => typeof c === "string")
                : []
            const rows = Array.isArray(item.rows)
                ? item.rows.filter((r): r is string[] => Array.isArray(r))
                : []
            return columns.length ? {type: "table", columns, rows} : null
        }
        case "image":
            return typeof item.url === "string"
                ? {
                      type: "image",
                      url: item.url,
                      caption: typeof item.caption === "string" ? item.caption : undefined,
                  }
                : null
        default:
            return null
    }
}

/**
 * One conversation item's `content` array -> a node list. Consecutive live
 * `button` parts (never grouped by the API) collapse into one `button-run`;
 * everything else falls through to `parseAgentaNode` per item.
 */
export function groupAgentaNodes(parts: unknown[]): AgentaNode[] {
    const nodes: AgentaNode[] = []
    let run: AgentaLiveButton[] = []

    const flushRun = () => {
        if (run.length) {
            nodes.push({type: "button-run", buttons: run})
            run = []
        }
    }

    for (const raw of parts) {
        if (!raw || typeof raw !== "object") continue
        const item = raw as Record<string, unknown>

        if (item.type === "button") {
            const value =
                typeof item.value === "string"
                    ? item.value
                    : typeof item.id === "string"
                      ? item.id
                      : ""
            if (value) {
                run.push({
                    id: typeof item.id === "string" ? item.id : undefined,
                    label: typeof item.label === "string" ? item.label : value,
                    value,
                })
            }
            continue
        }

        flushRun()

        if (item.type === "card") {
            nodes.push({
                type: "card",
                title: typeof item.title === "string" ? item.title : undefined,
                tool: typeof item.tool === "string" ? item.tool : undefined,
                arguments:
                    item.arguments && typeof item.arguments === "object"
                        ? (item.arguments as Record<string, unknown>)
                        : undefined,
            })
            continue
        }

        const node = parseAgentaNode(item)
        if (node) nodes.push(node)
    }

    flushRun()
    return nodes
}
