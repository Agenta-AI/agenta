import {AppCard} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"

// AppCard — the Composio catalog provider tile, with a connected/pending status dot.
const meta = {
    title: "@agenta/entity-ui/Drawers/CatalogAppCard",
    component: AppCard,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Provider tile shared by the trigger and tool catalogs. Shows a status dot with a tooltip when the provider is connected or pending.",
            },
        },
    },
} satisfies Meta<typeof AppCard>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[260px]">{children}</div>
    </div>
)

export const Variants: Story = {
    args: {name: "GitHub", onClick: noop},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="connected">
                <AppCard
                    name="GitHub"
                    description="Repos, issues and pull requests"
                    categories={["developer tools", "crm"]}
                    actionsCount={42}
                    connected
                    onClick={noop}
                />
            </Row>
            <Row label="pending">
                <AppCard name="Slack" description="Messages and channels" pending onClick={noop} />
            </Row>
            <Row label="plain · subtle variant">
                <AppCard name="Linear" variant="subtle" actionsCount={7} onClick={noop} />
            </Row>
        </div>
    ),
}
