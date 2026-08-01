import {SourceIndicator, Tag as AgentaTag, VersionBadge} from "@agenta/ui/components/presentational"
import {TypeChip} from "@agenta/ui/type-chip"
import {Badge} from "@agenta/ui/ui"
import {Lightning, PencilSimpleLine} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag} from "antd"

// The current tag/status presets this ONE @agenta/ui Badge must reproduce.

/**
 * Badge — the @agenta/ui primitive that consolidates 7 current tag/status presets
 * (DraftTag, SyncStateTag, StatusTag, SourceIndicator, VersionBadge, MappingStatusTag,
 * TypeChip) into one component + variants. See antd-inventory/agenta-ui-consolidation.md.
 *
 * This file is the ACCEPTANCE BASELINE: it renders the real presets as they render today.
 * The consolidated @agenta/ui `Badge` (built next) lands beside them and must match pixel-for-pixel.
 */
const meta = {
    title: "@agenta/ui/Primitives/Display/Badge",
    component: Badge,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Badge that consolidates seven current antd `Tag`-based presets (DraftTag, SyncStateTag, StatusTag, SourceIndicator, VersionBadge, MappingStatusTag, TypeChip) into one component + variants.\n\n**Used in:** 6 places, nearly all of them wrappers rather than app code — `Tag`, `SourceIndicator`, `FormattedDate`, `ExecutionMetricsDisplay` and the metric cell renderer. The one direct app call-site is the evaluation-runs table category tags.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="flex items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="w-40 shrink-0 text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
)

/** The 7→1 target: every current preset one Badge must reproduce. */
export const CurrentPresets: Story = {
    render: () => (
        <div className="flex flex-col max-w-[720px]">
            <Row label="DraftTag → Badge/draft">
                <AgentaTag draft />
                <AgentaTag draft showIcon={false} />
                <AgentaTag draft label="Unsaved" />
            </Row>
            <Row label="SyncStateTag → Badge/sync">
                <AgentaTag sync="unmodified" />
                <AgentaTag sync="modified" />
                <AgentaTag sync="new" />
            </Row>
            <Row label="StatusTag → Badge/status">
                <AgentaTag status="success" />
                <AgentaTag status="error" />
                <AgentaTag status="running" />
                <AgentaTag status="pending" />
                <AgentaTag status="idle" />
            </Row>
            <Row label="VersionBadge → Badge/version">
                <VersionBadge version={3} variant="text" />
                <VersionBadge version={3} variant="chip" />
                <VersionBadge version={12} variant="bold" />
            </Row>
            <Row label="SourceIndicator → Badge/source">
                <SourceIndicator icon={<Lightning size={14} />} name="OpenAI" connected />
                <SourceIndicator icon={<Lightning size={14} />} name="Custom" connected={false} />
                <SourceIndicator icon={<Lightning size={14} />} name="Local" modified />
            </Row>
            <Row label="TypeChip → Badge/type (rebase)">
                <TypeChip variant="string" />
                <TypeChip variant="number" />
                <TypeChip variant="boolean" />
                <TypeChip variant="markdown" />
                <TypeChip variant="draft" />
                <TypeChip variant="optional" />
            </Row>
        </div>
    ),
}

/**
 * Proposed unified variant surface: one Badge with semantic color families + fill mode.
 * (Rendered here with antd Tag re-skinned to theme as the current baseline; the @agenta/ui
 * Badge replaces this with matching variants.)
 */
export const SemanticVariants: Story = {
    render: () => (
        <div className="flex flex-col max-w-[720px]">
            <Row label="color (filled)">
                <Tag>default</Tag>
                <Tag color="success">success</Tag>
                <Tag color="warning">warning</Tag>
                <Tag color="error">error</Tag>
                <Tag color="processing">info</Tag>
            </Row>
            <Row label="variant=outlined">
                <Tag variant="outlined">default</Tag>
                <Tag variant="outlined" color="success">
                    success
                </Tag>
                <Tag variant="outlined" color="error">
                    error
                </Tag>
            </Row>
            <Row label="with icon / closeable">
                <Tag icon={<Lightning size={12} />}>with icon</Tag>
                <Tag closable>closeable</Tag>
            </Row>
        </div>
    ),
}

/**
 * The match-and-replace loop: antd Tag (current) vs the @agenta/ui Badge for
 * each semantic variant. They should be visually indistinguishable — same geometry,
 * same colors, same light/dark behavior.
 */
const CompareRow = ({
    label,
    antd,
    agenta,
}: {
    label: string
    // NOT antd in the `*Collapse` stories — they feed `<AgentaTag>` here, so those rows are a
    // facade-vs-primitive consistency check, not antd parity. The caption stays the literal
    // "antd" because vrt.mjs keys pair detection on that exact string. Real antd-vs-AgTag
    // coverage for every variant lives in Tag.stories.tsx.
    antd: React.ReactNode
    agenta: React.ReactNode
}) => (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-8">antd</span>
            {antd}
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-8">agenta</span>
            {agenta}
        </div>
    </div>
)

/** Preset collapse #1: the real DraftTag vs the @agenta/ui Badge `draft` variant. */
export const DraftCollapse: Story = {
    render: () => (
        <div className="flex flex-col max-w-[560px]">
            <CompareRow
                label="DraftTag (default)"
                antd={<AgentaTag draft />}
                agenta={
                    <Badge variant="draft" icon={<PencilSimpleLine size={14} />}>
                        Draft
                    </Badge>
                }
            />
            <CompareRow
                label="showIcon={false}"
                antd={<AgentaTag draft showIcon={false} />}
                agenta={<Badge variant="draft">Draft</Badge>}
            />
            <CompareRow
                label='label="Unsaved"'
                antd={<AgentaTag draft label="Unsaved" />}
                agenta={
                    <Badge variant="draft" icon={<PencilSimpleLine size={14} />}>
                        Unsaved
                    </Badge>
                }
            />
        </div>
    ),
}

/** Preset collapse #2: SyncStateTag — the consolidated Tag maps sync to a plain tone Badge. */
export const SyncCollapse: Story = {
    render: () => (
        <div className="flex flex-col max-w-[560px]">
            <CompareRow
                label='modified ("Edited")'
                antd={<AgentaTag sync="modified" />}
                agenta={<Badge variant="blue">Edited</Badge>}
            />
            <CompareRow
                label='new ("New")'
                antd={<AgentaTag sync="new" />}
                agenta={<Badge variant="green">New</Badge>}
            />
        </div>
    ),
}

/** Preset collapse #3: StatusTag (status enum → existing semantic variants). */
export const StatusCollapse: Story = {
    render: () => (
        <div className="flex flex-col max-w-[560px]">
            <CompareRow
                label="success / ready"
                antd={<AgentaTag status="success" />}
                agenta={<Badge variant="success">Success</Badge>}
            />
            <CompareRow
                label="error"
                antd={<AgentaTag status="error" />}
                agenta={<Badge variant="error">Error</Badge>}
            />
            <CompareRow
                label="pending / loading → warning"
                antd={<AgentaTag status="pending" />}
                agenta={<Badge variant="warning">Pending</Badge>}
            />
            <CompareRow
                label="running → processing"
                antd={<AgentaTag status="running" />}
                agenta={<Badge variant="processing">Running...</Badge>}
            />
            <CompareRow
                label="idle → default"
                antd={<AgentaTag status="idle" />}
                agenta={<Badge variant="default">Idle</Badge>}
            />
            <CompareRow
                label="size=small"
                antd={<AgentaTag status="success" size="small" />}
                agenta={
                    // Deliberate unification: the consolidated Tag adopted MappingStatusTag's
                    // `text-xs py-0` for small, dropping StatusTag's old `text-[10px] leading-tight`.
                    <Badge variant="success" className="text-xs py-0">
                        Success
                    </Badge>
                }
            />
        </div>
    ),
}

/**
 * antd preset colors vs Badge variants — used by SourceIndicator + MappingStatusTag and by
 * the 8-hue categorical tag cycle (TAG_COLORS). Every hue is antd's `color-1` bg + `color-7`
 * text; contrast on the light bgs is a palette-wide question, not a per-hue exception.
 */
export const PresetColors: Story = {
    render: () => (
        // Text colour deliberately diverges from antd on 5 of 16 pairs: antd's own
        // color-7-on-color-1 fails WCAG AA (gold was 2.76:1), so those sit one or two steps
        // down antd's ramp. See presetTag in palette.ts. Geometry stays measured.
        <div
            className="flex flex-col max-w-[560px]"
            data-vrt-expected="WCAG AA: 5 of 16 preset pairs bumped down antd's own ramp (gold 2.76→6.53, cyan 3.39→5.82, green 3.37→5.44, orange 3.34→5.09, purple dark 3.39→5.66)"
        >
            {(["blue", "green", "orange", "red", "purple", "cyan", "magenta", "gold"] as const).map(
                (c) => (
                    <CompareRow
                        key={c}
                        label={c}
                        antd={<Tag color={c}>{c}</Tag>}
                        agenta={<Badge variant={c}>{c}</Badge>}
                    />
                ),
            )}
        </div>
    ),
}

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex flex-col max-w-[720px]">
            <CompareRow label="default" antd={<Tag>default</Tag>} agenta={<Badge>default</Badge>} />
            <CompareRow
                label="success"
                antd={<Tag color="success">success</Tag>}
                agenta={<Badge variant="success">success</Badge>}
            />
            <CompareRow
                label="warning"
                antd={<Tag color="warning">warning</Tag>}
                agenta={<Badge variant="warning">warning</Badge>}
            />
            <CompareRow
                label="error"
                antd={<Tag color="error">error</Tag>}
                agenta={<Badge variant="error">error</Badge>}
            />
            <CompareRow
                label="info"
                antd={<Tag color="processing">info</Tag>}
                agenta={<Badge variant="info">info</Badge>}
            />
            <CompareRow
                label="outlined"
                antd={<Tag variant="outlined">outlined</Tag>}
                agenta={<Badge variant="outlined">outlined</Badge>}
            />
            {/* Every app tag passed the phosphor icon as a CHILD with `flex items-center gap-1`
                (DraftTag/MappingStatusTag, e29e3f8586^) — antd's 7px `> .anticon + span` slot gap
                never applies to an SVG, so the `icon` prop renders a 0-gap baseline-aligned icon
                no call-site ever shipped. Same convention as Tag.stories.tsx. */}
            <CompareRow
                label="with icon"
                antd={
                    <Tag className="flex items-center gap-1">
                        <Lightning size={12} />
                        icon
                    </Tag>
                }
                agenta={<Badge icon={<Lightning size={12} />}>icon</Badge>}
            />
        </div>
    ),
}
