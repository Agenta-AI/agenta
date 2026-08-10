import {VariantDetails} from "@agenta/entity-ui/variant"
import {Tag as AgentaTag} from "@agenta/ui/components"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Dropdown as AntDropdown, Space as AntSpace, Tag as AntTag, Typography} from "antd"

// VariantDetails — the name + vN + draft/latest cluster inside VariantDetailsWithStatus.
// The antd cell replays the pre-migration body verbatim (Space size=4 + Typography +
// filled Tag + Dropdown around the shared draft Tag); the agenta cell renders the
// migrated component (flex gap-1 + span + Badge + DropdownMenu). Both halves render the
// SAME @agenta/ui draft Tag — that piece was already migrated before this pass.
const meta = {
    title: "@agenta/entity-ui/Variant/VariantDetails",
    component: VariantDetails,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Presentational variant name/revision cluster. antd `Space`/`Typography`/`Tag`/`Dropdown` → flex utilities, `span`, `@agenta/ui` `Badge` and `DropdownMenu`.",
            },
        },
    },
} satisfies Meta<typeof VariantDetails>

export default meta
type Story = StoryObj<typeof meta>

interface DetailsArgs {
    variantName?: string
    revision?: number | string | null
    showRevisionAsTag?: boolean
    hasChanges?: boolean
    showLatestTag?: boolean
    isLatest?: boolean
    onDiscardDraft?: () => void
    hideDiscard?: boolean
}

const noop = () => undefined

/** The pre-migration VariantDetails body, verbatim (antd Space/Typography/Tag/Dropdown). */
const AntdVariantDetails = ({
    variantName,
    revision,
    showRevisionAsTag = true,
    hasChanges = false,
    showLatestTag = true,
    isLatest = false,
    onDiscardDraft,
    hideDiscard = false,
}: DetailsArgs) => (
    <AntSpace size={4}>
        {variantName ? <Typography>{variantName}</Typography> : null}
        {revision !== undefined &&
            revision !== null &&
            revision !== "" &&
            (showRevisionAsTag ? (
                <AntTag className={`bg-[var(--ag-colorFillSecondary)]`} variant="filled">
                    v{revision}
                </AntTag>
            ) : (
                <Typography.Text>v{revision}</Typography.Text>
            ))}
        {hasChanges ? (
            hideDiscard ? (
                <AgentaTag draft />
            ) : (
                <AntDropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            {
                                key: "discard",
                                label: "Discard draft changes",
                                danger: true,
                                disabled: !onDiscardDraft,
                            },
                        ],
                        onClick: ({key}) => {
                            if (key === "discard") onDiscardDraft?.()
                        },
                    }}
                    placement="bottomLeft"
                >
                    <AgentaTag draft className="cursor-pointer" />
                </AntDropdown>
            )
        ) : (
            isLatest &&
            showLatestTag && (
                <AntTag
                    className={`bg-[var(--ag-c-E6F4FF)] text-[var(--ag-c-1677FF)]`}
                    variant="filled"
                >
                    Last modified
                </AntTag>
            )
        )}
    </AntSpace>
)

// Cells are fixed-width: in a squeezed 1fr column antd's Typography (a block
// `article` with break-word) collapses to vertical text while the migrated span
// wraps at word boundaries — a layout artifact, not the resting rendering.
const Row = ({label, args, expected}: {label: string; args: DetailsArgs; expected?: string}) => (
    <div
        className="grid grid-cols-[11rem_260px_260px] items-center gap-4 border-b border-colorBorderSecondary py-2"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div className="inline-flex" data-vrt-subject>
                <AntdVariantDetails {...args} />
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className="inline-flex" data-vrt-subject>
                <VariantDetails {...args} />
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {variantName: "My Agent", revision: 3},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="name + revision tag" args={{variantName: "My Agent", revision: 3}} />
            <Row
                label="revision as text"
                args={{variantName: "My Agent", revision: 3, showRevisionAsTag: false}}
            />
            <Row
                label="draft (discard dropdown, closed)"
                // Measured: antd's Space ITEM wraps the icon-bearing draft tag in an inline
                // line box that adds 0.8px descender (25.2 vs 24.4 total; contents shift
                // 0.4px). All child widths/heights/offsets are otherwise identical.
                expected="antd Space item line-box adds 0.8px descender under the icon-bearing tag (25.2 vs 24.4 measured); flex-gap version has no phantom descent — child geometry identical"
                args={{
                    variantName: "My Agent",
                    revision: 3,
                    hasChanges: true,
                    onDiscardDraft: noop,
                }}
            />
            <Row
                label="draft · hideDiscard"
                expected="antd Space item line-box adds 0.8px descender under the icon-bearing tag (25.2 vs 24.4 measured); flex-gap version has no phantom descent — child geometry identical"
                args={{
                    variantName: "My Agent",
                    revision: 3,
                    hasChanges: true,
                    hideDiscard: true,
                }}
            />
            <Row
                label="latest → Last modified"
                args={{variantName: "My Agent", revision: 12, isLatest: true}}
            />
            <Row label="no name (hidden)" args={{revision: 7}} />
        </div>
    ),
}
