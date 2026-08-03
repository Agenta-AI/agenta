import {useState, type ReactNode} from "react"

import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton} from "antd"

// Imported from source: the DrillInView barrel does not re-export the parameter editor.
import {
    ParameterTree,
    type ParameterTreeProps,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ParameterTree"
import type {
    Schema,
    Seg,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/schemaPaths"

// ParameterTree — the left rail of the tool-parameter master/detail editor: a nesting,
// selectable tree over a function tool's JSON-Schema `parameters`. Everything except the
// header "+ Add" affordance was already antd-free, so the parity pair is that button; the
// BRANCH MATRIX stories below are the real inventory value — every node kind (scalar, scalar
// array, object, array-of-object) at every nesting level, plus the empty and disabled states.
//
// antd swap: `Button type="link" icon={<Plus/>} className="!h-auto !p-0"` → `@agenta/ui`
// `Button variant="link" className="h-auto p-0"` with the icon as a child (the primitive has
// no `icon` prop; tailwind-merge makes the `!` overrides unnecessary).
const meta = {
    title: "@agenta/entity-ui/DrillIn/ParameterTree",
    component: ParameterTree,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Selectable JSON-Schema parameter tree. Object nodes expand to their properties; array-of-object nodes recurse through an `items` group; scalar arrays show a muted `items: <type>` leaf. The pinned 'Tool details' row is always reachable.",
            },
        },
    },
} satisfies Meta<typeof ParameterTree>

export default meta
type Story = StoryObj

const noop = () => undefined

// ---------------------------------------------------------------------------
// Fixtures — one schema per branch kind, and one that nests all of them
// ---------------------------------------------------------------------------

const FLAT: Schema = {
    type: "object",
    properties: {
        location: {type: "string", description: "City name"},
        days: {type: "integer"},
        metric: {type: "boolean"},
    },
    required: ["location"],
}

const SCALAR_ARRAY: Schema = {
    type: "object",
    properties: {
        tags: {type: "array", items: {type: "string"}},
        scores: {type: "array", items: {type: "number"}},
    },
    required: ["tags"],
}

const NESTED_OBJECT: Schema = {
    type: "object",
    properties: {
        filter: {
            type: "object",
            properties: {
                status: {type: "string"},
                since: {type: "string"},
            },
            required: ["status"],
        },
    },
}

const ARRAY_OF_OBJECT: Schema = {
    type: "object",
    properties: {
        recipients: {
            type: "array",
            items: {
                type: "object",
                properties: {email: {type: "string"}, name: {type: "string"}},
                required: ["email"],
            },
        },
    },
}

// Three levels deep: object → array-of-object → object, plus scalars and a scalar array.
const DEEP: Schema = {
    type: "object",
    properties: {
        query: {type: "string", description: "Search terms"},
        limit: {type: "integer"},
        labels: {type: "array", items: {type: "string"}},
        filter: {
            type: "object",
            properties: {
                status: {type: "string"},
                ranges: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            from: {type: "string"},
                            to: {type: "string"},
                            meta: {
                                type: "object",
                                properties: {source: {type: "string"}},
                                required: ["source"],
                            },
                        },
                        required: ["from"],
                    },
                },
            },
            required: ["status"],
        },
    },
    required: ["query"],
}

const EMPTY: Schema = {type: "object", properties: {}, required: []}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function TreeBox({
    schema,
    selectedPath: initialPath = null,
    metaSelected = false,
    disabled,
}: {
    schema: Schema
    selectedPath?: Seg[] | null
    metaSelected?: boolean
    disabled?: boolean
}) {
    const [selectedPath, setSelectedPath] = useState<Seg[] | null>(initialPath)
    const [meta, setMeta] = useState(metaSelected)
    const props: ParameterTreeProps = {
        schema,
        selectedPath,
        onSelect: (p) => {
            setSelectedPath(p)
            setMeta(false)
        },
        metaSelected: meta,
        onSelectMeta: () => {
            setMeta(true)
            setSelectedPath(null)
        },
        onAddRoot: noop,
        onAddProperty: noop,
        onRemove: noop,
        disabled,
    }
    return (
        <div className="flex h-[420px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary">
            <ParameterTree {...props} />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Branch matrix — the real inventory
// ---------------------------------------------------------------------------

/** Flat scalars: string / integer / boolean, one required (red dot). */
export const ScalarProperties: Story = {
    render: () => <TreeBox schema={FLAT} selectedPath={[{p: "location"}]} />,
}

/** Scalar arrays: `array<string>` / `array<number>` with the muted `items:` leaf. */
export const ScalarArrays: Story = {
    render: () => <TreeBox schema={SCALAR_ARRAY} selectedPath={[{p: "tags"}]} />,
}

/** Object node expanded to its child properties + the "Add property" affordance. */
export const NestedObject: Story = {
    render: () => <TreeBox schema={NESTED_OBJECT} selectedPath={[{p: "filter"}, {p: "status"}]} />,
}

/** Array-of-object: recursion goes through the `items` group. */
export const ArrayOfObject: Story = {
    render: () => (
        <TreeBox
            schema={ARRAY_OF_OBJECT}
            selectedPath={[{p: "recipients"}, {items: true}, {p: "email"}]}
        />
    ),
}

/** Three levels: object → array-of-object → object. Ancestors auto-expand to the selection. */
export const DeepNesting: Story = {
    render: () => (
        <TreeBox
            schema={DEEP}
            selectedPath={[{p: "filter"}, {p: "ranges"}, {items: true}, {p: "meta"}, {p: "source"}]}
        />
    ),
}

/** The pinned "Tool details" row selected — nothing in the tree is active. */
export const MetaSelected: Story = {
    render: () => <TreeBox schema={DEEP} metaSelected />,
}

/** No parameters yet: the guidance copy instead of a tree. */
export const EmptySchema: Story = {
    render: () => <TreeBox schema={EMPTY} metaSelected />,
}

/** Read-only: no "+ Add", no "Add property", no hover-remove. */
export const Disabled: Story = {
    render: () => <TreeBox schema={DEEP} selectedPath={[{p: "filter"}]} disabled />,
}

// ---------------------------------------------------------------------------
// Parity grid — the one migrated control
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex flex-1 items-center">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex flex-1 items-center">
                {s}
            </div>
        </div>
    </div>
)

// The migrated affordance, in the same header strip the component renders it in.
const Header = ({children}: {children: ReactNode}) => (
    <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
            Parameters
        </span>
        {children}
    </div>
)

/** The header "+ Add" button — the only antd control the tree carried. */
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label='header "+ Add"'
                a={
                    <Header>
                        <AntButton type="link" className="!h-auto !p-0" icon={<Plus size={13} />}>
                            Add
                        </AntButton>
                    </Header>
                }
                s={
                    <Header>
                        <Button variant="link" className="h-auto p-0">
                            <Plus size={13} />
                            Add
                        </Button>
                    </Header>
                }
            />
            <Row
                label='header "+ Add" · disabled'
                a={
                    <Header>
                        <AntButton
                            type="link"
                            className="!h-auto !p-0"
                            icon={<Plus size={13} />}
                            disabled
                        >
                            Add
                        </AntButton>
                    </Header>
                }
                s={
                    <Header>
                        <Button variant="link" className="h-auto p-0" disabled>
                            <Plus size={13} />
                            Add
                        </Button>
                    </Header>
                }
            />
        </div>
    ),
}
