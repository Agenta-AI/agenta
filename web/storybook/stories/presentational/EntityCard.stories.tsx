import {EntityCard} from "@agenta/ui/components"
import {Lightning} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Display/EntityCard",
    component: EntityCard,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A catalog-style tile (icon + title + 2-line description + tag pills + meta slot). Pure presentational composite of @agenta/ui primitives.\n\n**Used in:** 1 place — the shared catalog app card (`@agenta/entity-ui` `drawers/shared/CatalogAppCard.tsx`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[280px]">{children}</div>
    </div>
)

const icon = <Lightning size={28} className="text-colorPrimary" />

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row label="bordered (default)">
                <EntityCard
                    icon={icon}
                    title="OpenAI"
                    description="Connect to GPT models for text generation and chat completions."
                    tags={["LLM", "Chat"]}
                    meta={<span className="text-[10px] text-colorTextSecondary">12 actions</span>}
                    onClick={() => {}}
                />
            </Row>
            <Row label="subtle variant">
                <EntityCard
                    variant="subtle"
                    icon={icon}
                    title="Custom Workflow"
                    description="A locally defined workflow with no remote connection."
                    tags={["Local"]}
                    onClick={() => {}}
                />
            </Row>
            <Row label="disabled">
                <EntityCard
                    disabled
                    icon={icon}
                    title="Coming soon"
                    description="This integration is not yet available."
                />
            </Row>
        </div>
    ),
}
