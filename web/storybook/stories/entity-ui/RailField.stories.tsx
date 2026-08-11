import {
    ChangedPathsProvider,
    RailField,
    railInfoLabel,
    type ChangedPaths,
} from "@agenta/entity-ui/drawers/shared"
import {Info} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Input as AntInput, Tooltip as AntTooltip} from "antd"

// RailField — one `[label column │ content]` drawer row. The antd cell replays the
// pre-migration resting markup verbatim from feat/storybook-data-seam (the changed-label
// popover trigger renders identically at rest; only the antd Tooltip/Popover/Button inside
// the overlays were swapped). Content inputs are antd on the antd half for a like-for-like row.
const meta = {
    title: "@agenta/entity-ui/Drawers/RailField",
    component: RailField,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A fixed 116px label column beside a bordered content panel, with an optional changed-property marker (dotted underline + click popover). antd `Tooltip`/`Popover`/`Button` → `@agenta/ui` equivalents; the popover panel carries antd Popover's 12px padding via `className`.",
            },
        },
    },
} satisfies Meta<typeof RailField>

export default meta
type Story = StoryObj<typeof meta>

/** Pre-migration RailField resting markup (no provider → plain label, same as before). */
const AntdRailField = ({
    label,
    align = "top",
    changed = false,
    children,
}: {
    label: React.ReactNode
    align?: "top" | "center"
    changed?: boolean
    children: React.ReactNode
}) => (
    <div className="flex gap-3">
        <div
            className={`box-border w-[116px] shrink-0 px-2.5 text-xs ${
                align === "center" ? "self-center" : "pt-1.5"
            } ${changed ? "text-[var(--ag-colorText)]" : "text-[var(--ag-colorTextSecondary)]"}`}
        >
            {changed ? (
                <span className="cursor-pointer underline decoration-[var(--ag-colorInfo)] decoration-dotted underline-offset-4">
                    {label}
                </span>
            ) : (
                label
            )}
        </div>
        <div className="flex min-w-0 max-w-prose flex-1 flex-col border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
            {children}
        </div>
    </div>
)

/** Pre-migration `railInfoLabel` (antd Tooltip on the info glyph — identical at rest). */
const antdInfoLabel = (label: React.ReactNode, hint: React.ReactNode) => (
    <span className="inline-flex items-center gap-1">
        {label}
        <AntTooltip title={hint}>
            <Info size={13} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
        </AntTooltip>
    </span>
)

const changedStub: ChangedPaths = {
    isChanged: (path) => path === "runner.permissions.default",
    hasChangedUnder: () => true,
    pathsUnder: () => ["runner.permissions.default"],
    changeFor: () => ({before: '"ask"', after: '"allow"'}),
    revert: () => undefined,
}

const content = <span className="py-1 text-xs text-[var(--ag-colorText)]">acceptEdits</span>

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[360px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[360px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {label: "Permissions", children: content},
    render: () => (
        <div className="flex max-w-[950px] flex-col">
            <Row
                label="plain (top align)"
                a={<AntdRailField label="Permissions">{content}</AntdRailField>}
                s={<RailField label="Permissions">{content}</RailField>}
            />
            <Row
                label="center align"
                a={
                    <AntdRailField label="Model" align="center">
                        <AntInput placeholder="claude-sonnet-4" />
                    </AntdRailField>
                }
                s={
                    <RailField label="Model" align="center">
                        <AntInput placeholder="claude-sonnet-4" />
                    </RailField>
                }
            />
            <Row
                label="info label (tooltip)"
                a={
                    <AntdRailField label={antdInfoLabel("Sandbox", "Where the agent runs")}>
                        {content}
                    </AntdRailField>
                }
                s={
                    <RailField label={railInfoLabel("Sandbox", "Where the agent runs")}>
                        {content}
                    </RailField>
                }
            />
            <Row
                label="changed property"
                a={
                    <AntdRailField label="Default mode" changed>
                        {content}
                    </AntdRailField>
                }
                s={
                    <ChangedPathsProvider changes={changedStub}>
                        <RailField label="Default mode" path="runner.permissions.default">
                            {content}
                        </RailField>
                    </ChangedPathsProvider>
                }
            />
        </div>
    ),
}
