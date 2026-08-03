import type {ReactNode} from "react"

import {CaretRight, FileText, Plugs, Trash} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag as AntTag, Tooltip as AntTooltip, Typography as AntTypography} from "antd"

// Imported from source: the DrillInView barrel does not re-export these rows.
import {
    describeInstruction,
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
// rows, their nested provider-group children, and the instructions-file row). The antd cell
// replays the pre-migration body verbatim from feat/storybook-data-seam.
//
// antd swaps: `Tag color=…` → presentational `Tag tone=…` (Badge preset hues; antd v6's
// default Tag variant is `filled`, i.e. border-transparent, which is exactly the Badge base);
// `Tooltip title` → Radix `Tooltip`/`TooltipContent` (rendered only when a tooltip exists —
// antd shows nothing for an empty title); `Typography.Text type="secondary"` → a plain span on
// `text-colorTextDescription` (antd's secondary Typography colour is `colorTextDescription`,
// which aliases `colorTextTertiary` — NOT `colorTextSecondary`).
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

// Declared, ungated: the preset-tag AA deviation the palette makes on purpose.
const PRESET_AA =
    "palette AA deviation (documented in oss/src/styles/theme/palette.ts `presetTag`): antd's color-7-on-color-1 preset pairing fails WCAG AA in light, so green steps 7→8 (#237804 vs antd #389e0d) and gold steps 7→9 (#874d00 vs antd #d48806). Dark matches antd exactly."

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
// Pre-migration markup, verbatim (antd baseline)
// ---------------------------------------------------------------------------

const STATUS_BORDER: Record<ItemRowStatusTone, string> = {
    new: "var(--ag-colorSuccessBorder)",
    edited: "var(--ag-colorInfoBorder)",
    invalid: "var(--ag-colorErrorBorder)",
    incomplete: "var(--ag-colorWarningBorder)",
}
const STATUS_TAG_COLOR: Record<ItemRowStatusTone, string> = {
    new: "green",
    edited: "blue",
    invalid: "red",
    incomplete: "gold",
}
const STATUS_ACCENT: Record<ItemRowStatusTone, string> = {
    new: "var(--ag-colorSuccess)",
    edited: "var(--ag-colorInfo)",
    invalid: "var(--ag-colorError)",
    incomplete: "var(--ag-colorWarning)",
}

const AntdStatusTag = ({status}: {status: ItemRowStatus}) => (
    <AntTooltip title={status.tooltip}>
        <AntTag color={STATUS_TAG_COLOR[status.tone]} className="m-0 text-[11px]">
            {status.label}
        </AntTag>
    </AntTooltip>
)

const AntdItemAvatar = ({descriptor}: {descriptor: ItemDescriptor}) => (
    <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[10px] font-semibold leading-none text-white"
        style={{background: descriptor.color}}
    >
        {descriptor.icon ?? descriptor.mono}
    </span>
)

const AntdItemRow = ({
    descriptor,
    onEdit,
    onRemove,
    locked,
    status,
}: {
    descriptor: ItemDescriptor
    onEdit?: () => void
    onRemove?: () => void
    locked?: boolean
    status?: ItemRowStatus
}) => {
    const interactive = Boolean(onEdit) && !locked
    return (
        <div
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            style={status ? {borderColor: STATUS_BORDER[status.tone]} : undefined}
            className={[
                "group flex items-center gap-2.5 rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-2 transition-colors",
                interactive && !status
                    ? "cursor-pointer hover:border-[var(--ag-c-97A4B0,#97a4b0)]"
                    : "",
                interactive && status ? "cursor-pointer" : "",
                locked ? "bg-[var(--ant-color-fill-quaternary)] opacity-70" : "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <AntdItemAvatar descriptor={descriptor} />
            <div className="min-w-0 flex-1">
                <div
                    className={`truncate text-xs font-medium ${
                        descriptor.monoName === false ? "" : "font-mono"
                    }`}
                >
                    {descriptor.name}
                </div>
                {descriptor.description ? (
                    <AntTypography.Text
                        type="secondary"
                        className="block truncate text-xs leading-tight"
                    >
                        {descriptor.description}
                    </AntTypography.Text>
                ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                {status ? <AntdStatusTag status={status} /> : null}
                {descriptor.tags.map((tag) => (
                    <AntTag key={tag} className="m-0 text-[11px]">
                        {tag}
                    </AntTag>
                ))}
                {locked ? <AntTag className="m-0 text-[11px]">Locked</AntTag> : null}
                {onRemove && !locked ? (
                    <button
                        type="button"
                        aria-label="Remove"
                        className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-c-97A4B0,#97a4b0)] opacity-0 transition-opacity hover:text-[var(--ag-c-FF4D4F,#ff4d4f)] group-hover:opacity-100"
                    >
                        <Trash size={14} />
                    </button>
                ) : null}
                {interactive ? (
                    <CaretRight size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                ) : null}
            </div>
        </div>
    )
}

const AntdItemChildRow = ({
    descriptor,
    onRemove,
    status,
}: {
    descriptor: ItemDescriptor
    onRemove?: () => void
    status?: ItemRowStatus
}) => (
    <div
        role="button"
        tabIndex={0}
        style={status ? {boxShadow: `inset 2px 0 0 ${STATUS_ACCENT[status.tone]}`} : undefined}
        className="group flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-1.5 transition-colors hover:bg-[var(--ag-colorFillSecondary)]"
    >
        <div className="min-w-0 flex-1">
            <div
                className={`truncate text-xs font-medium ${
                    descriptor.monoName === false ? "" : "font-mono"
                }`}
            >
                {descriptor.name}
            </div>
            {descriptor.description ? (
                <AntTypography.Text
                    type="secondary"
                    className="block truncate text-[11px] leading-snug"
                >
                    {descriptor.description}
                </AntTypography.Text>
            ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5" role="presentation">
            {status ? <AntdStatusTag status={status} /> : null}
            {onRemove ? (
                <button
                    type="button"
                    aria-label="Remove"
                    className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-c-97A4B0,#97a4b0)] opacity-0 transition-opacity hover:text-[var(--ag-c-FF4D4F,#ff4d4f)] group-hover:opacity-100"
                >
                    <Trash size={14} />
                </button>
            ) : null}
            <CaretRight size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
        </div>
    </div>
)

const AntdInstructionsFileRow = ({
    filename,
    content,
    status,
}: {
    filename: string
    content: string
    status?: ItemRowStatus
}) => {
    const descriptor = describeInstruction(filename, content)
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length
    const meta =
        wordCount > 0
            ? `Markdown · ${wordCount} word${wordCount === 1 ? "" : "s"}`
            : "Markdown · empty"
    return (
        <div
            role="button"
            tabIndex={0}
            style={status ? {borderColor: STATUS_BORDER[status.tone]} : undefined}
            className={`group flex cursor-pointer items-start gap-3 rounded-lg border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-2.5 transition-colors ${
                status ? "" : "hover:border-[var(--ag-c-97A4B0,#97a4b0)]"
            }`}
        >
            <AntdItemAvatar descriptor={descriptor} />
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-[13px] font-medium leading-tight">
                        {filename}
                    </span>
                    <AntTypography.Text type="secondary" className="shrink-0 text-[11px]">
                        {meta}
                    </AntTypography.Text>
                    {status ? <AntdStatusTag status={status} /> : null}
                </div>
                <AntTypography.Text
                    type="secondary"
                    className="mt-1 line-clamp-2 text-xs leading-snug"
                >
                    {descriptor.description}
                </AntTypography.Text>
            </div>
            <CaretRight size={15} className="mt-1 shrink-0 text-[var(--ag-c-97A4B0,#97a4b0)]" />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Parity grid
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
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
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

/** Every row kind and status tone, antd beside the migrated component. */
export const AntdVsAgenta: Story = {
    args: {descriptor: TOOL},
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="tool row"
                a={<AntdItemRow descriptor={TOOL} onEdit={noop} onRemove={noop} />}
                s={<ItemRow descriptor={TOOL} onEdit={noop} onRemove={noop} />}
            />
            <Row
                label="app tool (icon avatar, prose name, 2 tags)"
                a={<AntdItemRow descriptor={GATEWAY} onEdit={noop} onRemove={noop} />}
                s={<ItemRow descriptor={GATEWAY} onEdit={noop} onRemove={noop} />}
            />
            <Row
                label="no description"
                a={<AntdItemRow descriptor={NO_DESC} onEdit={noop} />}
                s={<ItemRow descriptor={NO_DESC} onEdit={noop} />}
            />
            <Row
                label="non-interactive (no onEdit)"
                a={<AntdItemRow descriptor={TOOL} />}
                s={<ItemRow descriptor={TOOL} />}
            />
            <Row
                label="locked"
                a={<AntdItemRow descriptor={TOOL} onEdit={noop} locked />}
                s={<ItemRow descriptor={TOOL} onEdit={noop} locked />}
            />
            {(Object.keys(STATUSES) as ItemRowStatusTone[]).map((tone) => (
                <Row
                    key={tone}
                    label={`status · ${tone}`}
                    expected={tone === "new" || tone === "incomplete" ? PRESET_AA : undefined}
                    a={
                        <AntdItemRow
                            descriptor={TOOL}
                            onEdit={noop}
                            onRemove={noop}
                            status={STATUSES[tone]}
                        />
                    }
                    s={
                        <ItemRow
                            descriptor={TOOL}
                            onEdit={noop}
                            onRemove={noop}
                            status={STATUSES[tone]}
                        />
                    }
                />
            ))}
            <Row
                label="child row"
                a={<AntdItemChildRow descriptor={GATEWAY} onRemove={noop} />}
                s={<ItemChildRow descriptor={GATEWAY} onEdit={noop} onRemove={noop} />}
            />
            <Row
                label="child row · status"
                a={
                    <AntdItemChildRow
                        descriptor={GATEWAY}
                        onRemove={noop}
                        status={STATUSES.edited}
                    />
                }
                s={
                    <ItemChildRow
                        descriptor={GATEWAY}
                        onEdit={noop}
                        onRemove={noop}
                        status={STATUSES.edited}
                    />
                }
            />
            <Row
                label="instructions file"
                a={
                    <AntdInstructionsFileRow
                        filename={INSTRUCTIONS_FILE}
                        content={INSTRUCTIONS_BODY}
                    />
                }
                s={
                    <InstructionsFileRow
                        filename={INSTRUCTIONS_FILE}
                        content={INSTRUCTIONS_BODY}
                        onOpen={noop}
                    />
                }
            />
            <Row
                label="instructions file · empty"
                a={<AntdInstructionsFileRow filename="NOTES.md" content="" />}
                s={<InstructionsFileRow filename="NOTES.md" content="" onOpen={noop} />}
            />
            <Row
                label="status tag (no tooltip)"
                expected={PRESET_AA}
                a={<AntdStatusTag status={STATUSES.incomplete} />}
                s={<StatusTag status={STATUSES.incomplete} />}
            />
            <Row
                label="status tag (tooltip)"
                expected={PRESET_AA}
                a={<AntdStatusTag status={STATUSES.new} />}
                s={<StatusTag status={STATUSES.new} />}
            />
            <Row
                label="avatar · monogram"
                a={<AntdItemAvatar descriptor={TOOL} />}
                s={<ItemAvatar descriptor={TOOL} />}
            />
            <Row
                label="avatar · icon"
                a={<AntdItemAvatar descriptor={GATEWAY} />}
                s={<ItemAvatar descriptor={GATEWAY} />}
            />
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
