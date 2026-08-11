/**
 * The rendering vocabulary: text, buttons, select, fields, table, image.
 * No canonical wire shape exists yet anywhere in the API for the grouped
 * choice/fields/table/image nodes -- this is the reference definition, kept
 * close to the one shape that IS already live (`{type:"text", text}`, and
 * `id`/`label` on a choice option, per the Slack/mock adapters).
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

export type AgentaNode =
    | AgentaTextNode
    | AgentaButtonsNode
    | AgentaSelectNode
    | AgentaFieldsNode
    | AgentaTableNode
    | AgentaImageNode

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
