import type {ReactNode} from "react"

import {NEEDS_SETUP_LABEL, needsSetupReasonLabel} from "@agenta/entities/workflow"
import {FileText, Plugs} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the DrillInView barrel does not re-export these rows.
import {
    describeMcp,
    describeSkill,
    type ItemDescriptor,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/itemDescriptors"
import {
    InstructionsFileRow,
    ItemAvatar,
    ItemChildRow,
    ItemRow,
    StatusTag,
    type ItemRowStatus,
    type ItemRowStatusTone,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ItemRow"

// ItemRow — the presentational rows of the agent-template config sections (tool / MCP / skill
// rows, their nested provider-group children, and the instructions-file row).
const meta = {
    title: "@agenta/entity-ui/DrillIn/ItemRow",
    component: ItemRow,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Config-item rows: avatar + name/description + type tags + chevron, a compact borderless child row, and the instructions markdown row with a 2-line preview. Draft/validation status tints the border and adds a tag.",
            },
        },
    },
} satisfies Meta<typeof ItemRow>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOOL: ItemDescriptor = {
    name: "get_weather",
    description: "Get current weather for a city",
    mono: "fn",
    color: "#2563eb",
    tags: ["definition"],
    typeLabel: "definition",
    subtitle: "A JSON-schema tool executed by your app",
}

const GATEWAY: ItemDescriptor = {
    name: "Create issue",
    monoName: false,
    description: "Open a new issue in a repository",
    mono: "gh",
    color: "#0f172a",
    icon: <Plugs size={14} />,
    tags: ["github", "app"],
    typeLabel: "app tool",
    subtitle: "A connected-app action",
}

// The stored MCP shape (what `buildMcpAgentItem` writes), through the real classifier. A saved
// item names its connection by slug and carries no URL, so the row shows the name alone.
const MCP = describeMcp({
    name: "linear",
    connection: {type: "gateway", namespace: "custom", slug: "linear"},
    policy: {tools: {mode: "all"}},
})
// An inline server still carries its address, which the row shows under the name.
const MCP_WITH_URL = describeMcp({
    name: "internal_docs",
    connection: {url: "https://mcp.example.com/mcp"},
})
// The rail's status for a server whose sign-in lapsed (`needsSetupStatus` for `needs_sign_in`).
const MCP_SIGN_IN_EXPIRED: ItemRowStatus = {
    tone: "incomplete",
    label: NEEDS_SETUP_LABEL,
    reason: needsSetupReasonLabel("needs_sign_in") ?? undefined,
    needsSetup: true,
}

// Skills through the real classifier: an inline package, a registry reference and a built-in.
const SKILL = describeSkill({
    name: "laptop-replacement-policy",
    description: "When and how an employee gets a new laptop",
    body: "...",
})
const SKILL_PINNED = describeSkill({
    "@ag.embed": {"@ag.references": {workflow_revision: {slug: "pr-review-9c1d", version: "3"}}},
    name: "pr-review",
    description: "Review a pull request against the team checklist",
})
const SKILL_BUILTIN = describeSkill({
    "@ag.embed": {"@ag.references": {workflow: {slug: "__ag__web-search"}}},
    name: "web-search",
})

const NO_DESC: ItemDescriptor = {
    name: "list_files",
    mono: "fn",
    color: "#7c3aed",
    tags: [],
    typeLabel: "definition",
    subtitle: "A JSON-schema tool executed by your app",
}

const INSTRUCTIONS_FILE = "AGENTS.md"
const INSTRUCTIONS_BODY = `# Agent instructions

Always answer in the user's language. Prefer short, direct answers and cite the tool you
used. When a tool fails, say so and retry once before giving up.`

const STATUSES: Record<ItemRowStatusTone, ItemRowStatus> = {
    new: {tone: "new", label: "New", tooltip: "Added in this draft"},
    edited: {tone: "edited", label: "Edited", tooltip: "Changed since the last commit"},
    invalid: {tone: "invalid", label: "Invalid", tooltip: "Fix the schema before committing"},
    incomplete: {tone: "incomplete", label: "Incomplete"},
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center">
            <div className="flex-1">{children}</div>
        </div>
    </div>
)

/** Every row kind and status tone. */
export const Variants: Story = {
    args: {descriptor: TOOL},
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row label="tool row">
                <ItemRow descriptor={TOOL} onEdit={noop} onRemove={noop} />
            </Row>
            <Row label="app tool (icon avatar, prose name, 2 tags)">
                <ItemRow descriptor={GATEWAY} onEdit={noop} onRemove={noop} />
            </Row>
            <Row label="no description">
                <ItemRow descriptor={NO_DESC} onEdit={noop} />
            </Row>
            <Row label="non-interactive (no onEdit)">
                <ItemRow descriptor={TOOL} />
            </Row>
            <Row label="locked">
                <ItemRow descriptor={TOOL} onEdit={noop} locked />
            </Row>
            {(Object.keys(STATUSES) as ItemRowStatusTone[]).map((tone) => (
                <Row key={tone} label={`status · ${tone}`}>
                    <ItemRow
                        descriptor={TOOL}
                        onEdit={noop}
                        onRemove={noop}
                        status={STATUSES[tone]}
                    />
                </Row>
            ))}
            <Row label="child row">
                <ItemChildRow descriptor={GATEWAY} onEdit={noop} onRemove={noop} />
            </Row>
            <Row label="child row · status">
                <ItemChildRow
                    descriptor={GATEWAY}
                    onEdit={noop}
                    onRemove={noop}
                    status={STATUSES.edited}
                />
            </Row>
            <Row label="instructions file">
                <InstructionsFileRow
                    filename={INSTRUCTIONS_FILE}
                    content={INSTRUCTIONS_BODY}
                    onOpen={noop}
                />
            </Row>
            <Row label="instructions file · empty">
                <InstructionsFileRow filename="NOTES.md" content="" onOpen={noop} />
            </Row>
            <Row label="status tag (no tooltip)">
                <StatusTag status={STATUSES.incomplete} />
            </Row>
            <Row label="status tag (tooltip)">
                <StatusTag status={STATUSES.new} />
            </Row>
            <Row label="avatar · monogram">
                <ItemAvatar descriptor={TOOL} />
            </Row>
            <Row label="avatar · icon">
                <ItemAvatar descriptor={GATEWAY} />
            </Row>
        </div>
    ),
}

/** The rows as a section stack — how they actually read inside a config section. */
export const SectionStack: Story = {
    args: {descriptor: TOOL},
    render: () => (
        <div className="flex max-w-[560px] flex-col gap-2">
            <ItemRow descriptor={TOOL} onEdit={noop} onRemove={noop} />
            <ItemRow descriptor={GATEWAY} onEdit={noop} onRemove={noop} status={STATUSES.new} />
            <div className="rounded border border-solid border-[var(--ag-colorBorderSecondary)] p-1.5">
                <div className="flex items-center gap-2 px-1 pb-1 text-[11px] uppercase tracking-wide text-colorTextTertiary">
                    <FileText size={12} /> github
                </div>
                <ItemChildRow descriptor={GATEWAY} onEdit={noop} onRemove={noop} />
                <ItemChildRow
                    descriptor={NO_DESC}
                    onEdit={noop}
                    onRemove={noop}
                    status={STATUSES.invalid}
                />
            </div>
            <ItemRow descriptor={MCP} onEdit={noop} onRemove={noop} />
            <ItemRow descriptor={NO_DESC} onEdit={noop} locked />
            <InstructionsFileRow
                filename={INSTRUCTIONS_FILE}
                content={INSTRUCTIONS_BODY}
                onOpen={noop}
                status={STATUSES.edited}
            />
        </div>
    ),
}

/** MCP server rows: the neutral server mark, the name in the sans font, and the needs-setup state. */
export const McpServerRows: Story = {
    args: {descriptor: MCP},
    render: () => (
        <div className="flex max-w-[560px] flex-col gap-2">
            <ItemRow descriptor={MCP} onEdit={noop} onRemove={noop} />
            <ItemRow descriptor={MCP_WITH_URL} onEdit={noop} onRemove={noop} />
            <ItemRow descriptor={MCP} onEdit={noop} status={MCP_SIGN_IN_EXPIRED} />
            <ItemRow descriptor={MCP} onEdit={noop} status={STATUSES.new} />
        </div>
    ),
}

/** Skill rows: the one skill mark, the readable title, and the "Agenta" tag on a built-in. */
export const SkillRows: Story = {
    args: {descriptor: SKILL},
    render: () => (
        <div className="flex max-w-[560px] flex-col gap-2">
            <ItemRow descriptor={SKILL} onEdit={noop} onRemove={noop} />
            <ItemRow descriptor={SKILL_PINNED} onEdit={noop} onRemove={noop} />
            <ItemRow descriptor={SKILL_BUILTIN} onEdit={noop} disabled />
            <ItemRow descriptor={MCP} onEdit={noop} onRemove={noop} />
        </div>
    ),
}
