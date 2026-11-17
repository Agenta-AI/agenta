import type {MappingStatus} from "@agenta/shared/utils"
import {Tag, type QueryStatus, type ExecutionStatus} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Tag — the single tag component (generic `tone`/`label` + domain presets). Each story shows one
// preset: `<Tag status|mapping|env|draft|sync>`.
const meta = {
    title: "@agenta/ui/Presentational/Tags/Tag",
    component: Tag,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The one tag component: generic `tone`/`label`/`icon`/`size` plus domain presets `status`/`mapping`/`env`/`draft`/`sync`. Renders the @agenta/ui Badge.\n\n**Used in:** 10 places — the deployments dashboard cards (and their skeleton), the playground variant config header, comparison navigation cards and deploy-variant modal, the playground shell, the evaluator configure panel, the workflow revision drawer, the variant details panel, and `EntityIconLabel`.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
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

/** `status` preset. */
export const Status: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            {STATUSES.map((status) => (
                <Row key={status} label={status}>
                    <Tag status={status} />
                </Row>
            ))}
            <Row label="success (small)">
                <Tag status="success" size="small" />
            </Row>
        </div>
    ),
}

const MAPPINGS: MappingStatus[] = [
    "auto",
    "manual",
    "missing",
    "invalid_path",
    "type_mismatch",
    "optional",
]

/** `mapping` preset. */
export const Mapping: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            {MAPPINGS.map((status) => (
                <Row key={status} label={status}>
                    <Tag mapping={status} />
                </Row>
            ))}
            <Row label="auto (with icon)">
                <Tag mapping="auto" showIcon />
            </Row>
            <Row label="missing (with icon)">
                <Tag mapping="missing" showIcon />
            </Row>
            <Row label="auto (small)">
                <Tag mapping="auto" size="small" />
            </Row>
        </div>
    ),
}

/** `env` preset. */
export const Environment: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="production">
                <Tag env="production" />
            </Row>
            <Row label="staging">
                <Tag env="staging" />
            </Row>
            <Row label="development">
                <Tag env="development" />
            </Row>
            <Row label="unknown (fallback)">
                <Tag env="Custom" />
            </Row>
        </div>
    ),
}

/** `draft` preset. */
export const Draft: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="default">
                <Tag draft />
            </Row>
            <Row label="showIcon={false}">
                <Tag draft showIcon={false} />
            </Row>
            <Row label='label="Unsaved"'>
                <Tag draft label="Unsaved" />
            </Row>
        </div>
    ),
}

/** `sync` preset. */
export const Sync: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label='modified → "Edited"'>
                <Tag sync="modified" />
            </Row>
            <Row label='new → "New"'>
                <Tag sync="new" />
            </Row>
            <Row label="modified · dismissible">
                <Tag sync="modified" dismissible onDismiss={() => {}} />
            </Row>
            <Row label="unmodified · renders null">
                <Tag sync="unmodified" />
            </Row>
        </div>
    ),
}
