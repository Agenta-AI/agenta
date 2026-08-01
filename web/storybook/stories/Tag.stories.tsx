import {getMappingStatusConfig, type MappingStatus} from "@agenta/shared/utils"
import {Tag, type QueryStatus, type ExecutionStatus} from "@agenta/ui/components/presentational"
import {MagicWand, PencilSimpleLine, Warning, X} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag as AntTag} from "antd"

// Tag — the single tag component (generic `tone`/`label` + domain presets). Each story shows
// one preset beside the antd Tag it replaces. The former StatusTag / MappingStatusTag /
// EnvironmentTag / DraftTag / SyncStateTag facades are gone — they're now
// `<Tag status|mapping|env|draft|sync>`.
const meta = {
    title: "@agenta/ui/Presentational/Tags/Tag",
    component: Tag,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The one tag component: generic `tone`/`label`/`icon`/`size` plus domain presets `status`/`mapping`/`env`/`draft`/`sync`. Renders the @agenta/ui Badge; replaced the former StatusTag / MappingStatusTag / EnvironmentTag / DraftTag / SyncStateTag facades.\n\n**Used in:** 10 places — the deployments dashboard cards (and their skeleton), the playground variant config header, comparison navigation cards and deploy-variant modal, the playground shell, the evaluator configure panel, the workflow revision drawer, the variant details panel, and `EntityIconLabel`.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    /** Declares a deliberate divergence: still measured and reported, but not gated. */
    expected?: string
}) => (
    <div
        className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

const STATUSES: (QueryStatus | ExecutionStatus)[] = [
    "idle",
    "pending",
    "loading",
    "running",
    "success",
    "ready",
    "error",
]

// Story-local antd reference — transcribed from the deleted getStatusColor/getStatusLabel
// helpers in StatusTag (e29e3f8586^), which the `Tag status=` preset replaced.
const ANTD_STATUS: Record<QueryStatus | ExecutionStatus, {color: string; label: string}> = {
    idle: {color: "default", label: "Idle"},
    pending: {color: "warning", label: "Pending"},
    loading: {color: "warning", label: "Loading..."},
    running: {color: "processing", label: "Running..."},
    success: {color: "success", label: "Success"},
    ready: {color: "success", label: "Ready"},
    error: {color: "error", label: "Error"},
}

/** `status` preset — was StatusTag. */
export const Status: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            {STATUSES.map((status) => (
                <Row
                    key={status}
                    label={status}
                    a={
                        <AntTag color={ANTD_STATUS[status].color}>
                            {ANTD_STATUS[status].label}
                        </AntTag>
                    }
                    s={<Tag status={status} />}
                />
            ))}
            <Row
                label="success (small)"
                // StatusTag's small was `text-[10px] leading-tight py-0`; the consolidation
                // standardised every preset on `text-xs py-0` and no call-site passed size="small".
                a={
                    <AntTag color="success" className="text-xs py-0">
                        Success
                    </AntTag>
                }
                s={<Tag status="success" size="small" />}
            />
        </div>
    ),
}

const MAPPING_ANTD: Record<MappingStatus, string> = {
    auto: "blue",
    manual: "green",
    missing: "red",
    invalid_path: "red",
    type_mismatch: "orange",
    optional: "default",
}
// Hues whose text colour deliberately differs from antd for WCAG AA (see presetTag).
const AA_HUES = new Set(["green", "orange", "cyan", "gold"])
const AA_NOTE =
    "WCAG AA: this hue sits one/two steps down antd's own ramp so preset tags reach 4.5:1 — see presetTag in palette.ts"

const MAPPINGS: MappingStatus[] = [
    "auto",
    "manual",
    "missing",
    "invalid_path",
    "type_mismatch",
    "optional",
]

/** `mapping` preset — was MappingStatusTag. */
export const Mapping: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            {MAPPINGS.map((status) => (
                <Row
                    key={status}
                    label={status}
                    expected={AA_HUES.has(MAPPING_ANTD[status]) ? AA_NOTE : undefined}
                    a={
                        <AntTag color={MAPPING_ANTD[status]}>
                            {getMappingStatusConfig(status).label}
                        </AntTag>
                    }
                    s={<Tag mapping={status} />}
                />
            ))}
            <Row
                label="auto (with icon)"
                // MappingStatusTag put the phosphor icon in the CHILDREN with `flex items-center
                // gap-1`, not antd's `icon` slot (e29e3f8586^); default size renders it at 12px.
                a={
                    <AntTag color="blue" className="flex items-center gap-1">
                        <MagicWand size={12} />
                        Auto
                    </AntTag>
                }
                s={<Tag mapping="auto" showIcon />}
            />
            <Row
                label="missing (with icon)"
                a={
                    <AntTag color="red" className="flex items-center gap-1">
                        <Warning size={12} />
                        Missing
                    </AntTag>
                }
                s={<Tag mapping="missing" showIcon />}
            />
            <Row
                label="auto (small)"
                a={
                    <AntTag color="blue" className="text-xs py-0">
                        Auto
                    </AntTag>
                }
                s={<Tag mapping="auto" size="small" />}
            />
        </div>
    ),
}

/** `env` preset — was EnvironmentTag. */
export const Environment: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            {/* EnvironmentTag used inline --ag-env-* CSS vars, never antd presets (e29e3f8586^). */}
            <Row
                label="production"
                a={
                    <AntTag
                        className="w-fit"
                        style={{
                            backgroundColor: "var(--ag-env-production-bg)",
                            color: "var(--ag-env-production-text)",
                            borderColor: "var(--ag-env-production-border)",
                        }}
                    >
                        Production
                    </AntTag>
                }
                s={<Tag env="production" />}
            />
            <Row
                label="staging"
                a={
                    <AntTag
                        className="w-fit"
                        style={{
                            backgroundColor: "var(--ag-env-staging-bg)",
                            color: "var(--ag-env-staging-text)",
                            borderColor: "var(--ag-env-staging-border)",
                        }}
                    >
                        Staging
                    </AntTag>
                }
                s={<Tag env="staging" />}
            />
            <Row
                label="development"
                a={
                    <AntTag
                        className="w-fit"
                        style={{
                            backgroundColor: "var(--ag-env-development-bg)",
                            color: "var(--ag-env-development-text)",
                            borderColor: "var(--ag-env-development-border)",
                        }}
                    >
                        Development
                    </AntTag>
                }
                s={<Tag env="development" />}
            />
            <Row
                label="unknown (fallback)"
                a={<AntTag className="w-fit">Custom</AntTag>}
                s={<Tag env="Custom" />}
            />
        </div>
    ),
}

// Raw --ag-c-* literals are banned in component code but correct here: the story reproduces history.
const DRAFT_ANTD =
    "flex items-center gap-1 font-normal bg-[var(--ag-c-FFFBE6)] text-[var(--ag-c-D48806)] border-[var(--ag-c-FFE58F)]"

/** `draft` preset — was DraftTag. */
export const Draft: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            {/* DraftTag was amber, not default grey, and passed the icon as a CHILD (e29e3f8586^) —
                antd's 7px `> .anticon + span` gap never applied to a phosphor SVG, so gap-1 rules. */}
            <Row
                label="default"
                a={
                    <AntTag className={DRAFT_ANTD}>
                        <PencilSimpleLine size={14} />
                        Draft
                    </AntTag>
                }
                s={<Tag draft />}
            />
            <Row
                label="showIcon={false}"
                a={<AntTag className={DRAFT_ANTD}>Draft</AntTag>}
                s={<Tag draft showIcon={false} />}
            />
            <Row
                label='label="Unsaved"'
                a={
                    <AntTag className={DRAFT_ANTD}>
                        <PencilSimpleLine size={14} />
                        Unsaved
                    </AntTag>
                }
                s={<Tag draft label="Unsaved" />}
            />
        </div>
    ),
}

/** `sync` preset — was SyncStateTag. */
export const Sync: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label='modified → "Edited"'
                a={<AntTag color="blue">Edited</AntTag>}
                s={<Tag sync="modified" />}
            />
            <Row
                label='new → "New"'
                expected={AA_NOTE}
                a={<AntTag color="green">New</AntTag>}
                s={<Tag sync="new" />}
            />
            <Row
                label="modified · dismissible — 2.25px glyph lift not reproduced (antd is off-centre)"
                // Pre-migration SyncStateTag put a phosphor X in antd's `closeIcon` SLOT (e29e3f8586^),
                // so that is the baseline — not a literal "×" in the label, and not antd's own glyph.
                // Geometry stays antd-default, matching the two rows above (the consolidated `Tag`
                // standardised every preset on the Badge/antd-default shape). Its `ml-1` is dropped:
                // `.ant-tag-close-icon`'s margin-inline-start:3px outranks it, so it was inert.
                // Gate opt-out is for the glyph's VERTICAL position only: both halves rasterise the
                // SAME phosphor X (identical 14x15 device-pixel ink, 78 px each), but `.ant-tag` is
                // `display:inline-block` and `.ant-tag-close-icon` sets no `vertical-align`
                // (tag/style/index.js L26-57), so a bare <svg> sits on the text baseline — 2.25px
                // above the tag's centre. Our Tag flex-centres it.
                a={
                    <AntTag color="blue" closeIcon={<X size={12} />} onClose={() => {}}>
                        Edited
                    </AntTag>
                }
                s={<Tag sync="modified" dismissible onDismiss={() => {}} />}
            />
            <Row
                label="unmodified · renders null (not reproduced — nothing to diff)"
                a={<span className="text-[10px] text-colorTextSecondary">nothing</span>}
                s={<Tag sync="unmodified" />}
            />
        </div>
    ),
}
