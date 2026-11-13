import {SourceIndicator, Tag as AgentaTag, VersionBadge} from "@agenta/ui/components/presentational"
import {TypeChip} from "@agenta/ui/type-chip"
import {Badge} from "@agenta/ui/ui"
import {Lightning, PencilSimpleLine} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Display/Badge",
    component: Badge,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Badge that consolidates the tag and status presets (DraftTag, SyncStateTag, StatusTag, SourceIndicator, VersionBadge, MappingStatusTag, TypeChip) into one component with semantic variants.\n\n**Used in:** 6 places, nearly all of them wrappers rather than app code — `Tag`, `SourceIndicator`, `FormattedDate`, `ExecutionMetricsDisplay` and the metric cell renderer. The one direct app call-site is the evaluation-runs table category tags.",
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

/** The tag and status presets built on the Badge. */
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

/** The draft variant. */
export const DraftCollapse: Story = {
    render: () => (
        <div className="flex flex-col max-w-[560px]">
            <Row label="DraftTag (default)">
                <Badge variant="draft" icon={<PencilSimpleLine size={14} />}>
                    Draft
                </Badge>
            </Row>
            <Row label="showIcon={false}">
                <Badge variant="draft">Draft</Badge>
            </Row>
            <Row label='label="Unsaved"'>
                <Badge variant="draft" icon={<PencilSimpleLine size={14} />}>
                    Unsaved
                </Badge>
            </Row>
        </div>
    ),
}

/** Sync state maps to a plain tone Badge. */
export const SyncCollapse: Story = {
    render: () => (
        <div className="flex flex-col max-w-[560px]">
            <Row label='modified ("Edited")'>
                <Badge variant="blue">Edited</Badge>
            </Row>
            <Row label='new ("New")'>
                <Badge variant="green">New</Badge>
            </Row>
        </div>
    ),
}

/** Status enum values map to the semantic variants. */
export const StatusCollapse: Story = {
    render: () => (
        <div className="flex flex-col max-w-[560px]">
            <Row label="success / ready">
                <Badge variant="success">Success</Badge>
            </Row>
            <Row label="error">
                <Badge variant="error">Error</Badge>
            </Row>
            <Row label="pending / loading → warning">
                <Badge variant="warning">Pending</Badge>
            </Row>
            <Row label="running → processing">
                <Badge variant="processing">Running...</Badge>
            </Row>
            <Row label="idle → default">
                <Badge variant="default">Idle</Badge>
            </Row>
            <Row label="size=small">
                <Badge variant="success" className="text-xs py-0">
                    Success
                </Badge>
            </Row>
        </div>
    ),
}

/**
 * The 8 preset hues, used by SourceIndicator, MappingStatusTag and the categorical tag cycle.
 */
export const PresetColors: Story = {
    render: () => (
        <div className="flex flex-col max-w-[560px]">
            {(["blue", "green", "orange", "red", "purple", "cyan", "magenta", "gold"] as const).map(
                (c) => (
                    <Row key={c} label={c}>
                        <Badge variant={c}>{c}</Badge>
                    </Row>
                ),
            )}
        </div>
    ),
}

export const Variants: Story = {
    render: () => (
        <div className="flex flex-col max-w-[720px]">
            <Row label="default">
                <Badge>default</Badge>
            </Row>
            <Row label="success">
                <Badge variant="success">success</Badge>
            </Row>
            <Row label="warning">
                <Badge variant="warning">warning</Badge>
            </Row>
            <Row label="error">
                <Badge variant="error">error</Badge>
            </Row>
            <Row label="info">
                <Badge variant="info">info</Badge>
            </Row>
            <Row label="outlined">
                <Badge variant="outlined">outlined</Badge>
            </Row>
            <Row label="with icon">
                <Badge icon={<Lightning size={12} />}>icon</Badge>
            </Row>
        </div>
    ),
}
