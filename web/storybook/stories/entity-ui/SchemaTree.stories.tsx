import {SchemaTree} from "@agenta/entity-ui/drill-in"
import {Tag} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SchemaTree — read-only recursive JSON-schema viewer: plain markup on `--ag-*` tokens plus the
// red "required" `Tag`.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SchemaTree",
    component: SchemaTree,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Recursive, read-only JSON-schema viewer: name · type · required/optional, with nested objects indented under a left guide line.",
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {schema: FLAT},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="required pill">
                <Tag tone="red" className="m-0 px-1.5 py-0 text-[10px] leading-[18px]">
                    required
                </Tag>
            </Row>
            <Row label="flat schema">
                <SchemaTree schema={FLAT} />
            </Row>
            <Row label="nested schema">
                <SchemaTree schema={NESTED} />
            </Row>
            <Row label="empty">
                <SchemaTree schema={EMPTY} emptyText="No declared inputs" />
            </Row>
        </div>
    ),
}
