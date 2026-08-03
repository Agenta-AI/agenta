import {SchemaTree} from "@agenta/entity-ui/drill-in"
import {Tag} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag as AntTag} from "antd"

// SchemaTree — read-only recursive JSON-schema viewer. The only antd it ever imported was
// `Tag` (the red "required" pill); everything else is plain markup on `--ag-*` tokens. The
// parity story therefore pairs the pre-migration antd body (replayed verbatim below) against
// the migrated component.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SchemaTree",
    component: SchemaTree,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Recursive, read-only JSON-schema viewer: name · type · required/optional, with nested objects indented under a left guide line. antd `Tag color="red" bordered={false}` → `@agenta/ui` `Tag tone="red"`.',
            },
        },
    },
} satisfies Meta<typeof SchemaTree>

export default meta
type Story = StoryObj<typeof meta>

// ---------------------------------------------------------------------------
// Fixtures — the branch matrix the renderer handles
// ---------------------------------------------------------------------------

const FLAT = {
    type: "object",
    required: ["query"],
    properties: {
        query: {type: "string", description: "The search phrase to run."},
        limit: {type: "integer"},
        verbose: {type: "boolean"},
    },
}

const NESTED = {
    type: "object",
    description: "Inputs accepted by the referenced workflow.",
    required: ["prompt", "options"],
    properties: {
        prompt: {type: "string", description: "The user prompt."},
        options: {
            type: "object",
            required: ["model"],
            properties: {
                model: {type: "string"},
                temperature: {type: "number", description: "0–2, higher is more random."},
                stop: {type: "array", items: {type: "string"}},
            },
        },
        history: {
            type: "array",
            items: {
                type: "object",
                required: ["role"],
                properties: {
                    role: {type: "string"},
                    content: {type: ["string", "null"], description: "Message body."},
                },
            },
        },
        metadata: {type: "object"},
    },
}

const EMPTY = {type: "object", properties: {}}

/** Flat object: required + optional, a description line, scalar types. */
export const Flat: Story = {args: {schema: FLAT}}

/** Every branch at once: root description, nested object, array-of-objects, union type. */
export const Nested: Story = {args: {schema: NESTED}}

/** No declared properties → the `emptyText` fallback. */
export const Empty: Story = {args: {schema: EMPTY, emptyText: "No declared inputs"}}

/** `schema` is not an object at all (null/garbage) → same empty fallback, no throw. */
export const NoSchema: Story = {args: {schema: null}}

// ---------------------------------------------------------------------------
// Parity: pre-migration antd body vs the migrated component
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

// --- pre-migration body, verbatim except the antd `Tag` it still carries -----------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function typeLabel(def: Record<string, unknown>): string {
    const t = def.type
    if (t === "array") {
        const items = isRecord(def.items) ? def.items : null
        const itemType = items && typeof items.type === "string" ? items.type : null
        return itemType ? `array<${itemType}>` : "array"
    }
    if (Array.isArray(t)) {
        const parts = t.filter((x): x is string => typeof x === "string")
        return parts.length ? parts.join(" | ") : "any"
    }
    if (typeof t === "string") return t
    return "any"
}

function childSchema(def: Record<string, unknown>): Record<string, unknown> | null {
    if (def.type === "object" && isRecord(def.properties)) return def
    if (def.type === "array" && isRecord(def.items)) {
        const items = def.items
        if (items.type === "object" && isRecord(items.properties)) return items
    }
    return null
}

function AntdSchemaRows({node, depth}: {node: Record<string, unknown>; depth: number}) {
    const props = isRecord(node.properties) ? node.properties : {}
    const required = Array.isArray(node.required) ? (node.required as unknown[]) : []
    const entries = Object.entries(props)
    if (entries.length === 0) return null

    return (
        <div
            className={
                depth > 0
                    ? "flex flex-col border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3"
                    : "flex flex-col"
            }
        >
            {entries.map(([name, rawDef]) => {
                const def = isRecord(rawDef) ? rawDef : {}
                const child = childSchema(def)
                const description = typeof def.description === "string" ? def.description : ""
                return (
                    <div key={name} className="py-1.5">
                        <div className="flex items-baseline gap-2">
                            <span className="font-mono text-xs text-[var(--ag-colorText)]">
                                {name}
                            </span>
                            <span className="text-[11px] text-[var(--ag-colorTextSecondary)]">
                                {typeLabel(def)}
                            </span>
                            {required.includes(name) ? (
                                <AntTag
                                    color="red"
                                    bordered={false}
                                    className="m-0 px-1.5 py-0 text-[10px] leading-[18px]"
                                >
                                    required
                                </AntTag>
                            ) : (
                                <span className="text-[10px] text-[var(--ag-colorTextTertiary)]">
                                    optional
                                </span>
                            )}
                        </div>
                        {description ? (
                            <p className="m-0 mt-0.5 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                                {description}
                            </p>
                        ) : null}
                        {child ? (
                            <div className="mt-1">
                                <AntdSchemaRows node={child} depth={depth + 1} />
                            </div>
                        ) : null}
                    </div>
                )
            })}
        </div>
    )
}

function AntdSchemaTree({
    schema,
    emptyText = "No declared fields",
}: {
    schema: Record<string, unknown> | null | undefined
    emptyText?: string
}) {
    const node = isRecord(schema) ? schema : null
    const props = node && isRecord(node.properties) ? node.properties : {}
    const description = typeof node?.description === "string" ? node.description : ""

    if (Object.keys(props).length === 0) {
        return <div className="text-[11px] text-[var(--ag-colorTextTertiary)]">{emptyText}</div>
    }

    return (
        <div>
            {description ? (
                <p className="m-0 mb-1.5 text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                    {description}
                </p>
            ) : null}
            <AntdSchemaRows node={node as Record<string, unknown>} depth={0} />
        </div>
    )
}

export const AntdVsAgenta: Story = {
    args: {schema: FLAT},
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="required pill"
                a={
                    <AntTag
                        color="red"
                        bordered={false}
                        className="m-0 px-1.5 py-0 text-[10px] leading-[18px]"
                    >
                        required
                    </AntTag>
                }
                s={
                    <Tag tone="red" className="m-0 px-1.5 py-0 text-[10px] leading-[18px]">
                        required
                    </Tag>
                }
            />
            <Row
                label="flat schema"
                a={<AntdSchemaTree schema={FLAT} />}
                s={<SchemaTree schema={FLAT} />}
            />
            <Row
                label="nested schema"
                a={<AntdSchemaTree schema={NESTED} />}
                s={<SchemaTree schema={NESTED} />}
            />
            <Row
                label="empty"
                a={<AntdSchemaTree schema={EMPTY} emptyText="No declared inputs" />}
                s={<SchemaTree schema={EMPTY} emptyText="No declared inputs" />}
            />
        </div>
    ),
}
