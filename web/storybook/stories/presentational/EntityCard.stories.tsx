import {EntityCard} from "@agenta/ui/components"
import {Lightning} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// EntityCard — a catalog-style tile (icon + title + 2-line description + tag pills + meta slot).
// A pure presentational card with no antd counterpart, shown alone.
const meta = {
    title: "@agenta/ui/Presentational/Display/EntityCard",
    component: EntityCard,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A catalog-style tile (icon + title + 2-line description + tag pills + meta slot). Pure presentational composite of @agenta/ui primitives — no single antd counterpart.\n\n**Used in:** 1 place — the shared catalog app card (`@agenta/entity-ui` `drawers/shared/CatalogAppCard.tsx`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const AntdOnly = () => (
    <span className="text-[10px] italic text-colorTextSecondary">
        no single antd counterpart (composite of @agenta/ui primitives / layout)
    </span>
)

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[280px]">{s}</div>
        </div>
    </div>
)

const icon = <Lightning size={28} className="text-colorPrimary" />

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="bordered (default)"
                a={<AntdOnly />}
                s={
                    <EntityCard
                        icon={icon}
                        title="OpenAI"
                        description="Connect to GPT models for text generation and chat completions."
                        tags={["LLM", "Chat"]}
                        meta={
                            <span className="text-[10px] text-colorTextSecondary">12 actions</span>
                        }
                        onClick={() => {}}
                    />
                }
            />
            <Row
                label="subtle variant"
                a={<AntdOnly />}
                s={
                    <EntityCard
                        variant="subtle"
                        icon={icon}
                        title="Custom Workflow"
                        description="A locally defined workflow with no remote connection."
                        tags={["Local"]}
                        onClick={() => {}}
                    />
                }
            />
            <Row
                label="disabled"
                a={<AntdOnly />}
                s={
                    <EntityCard
                        disabled
                        icon={icon}
                        title="Coming soon"
                        description="This integration is not yet available."
                    />
                }
            />
        </div>
    ),
}
