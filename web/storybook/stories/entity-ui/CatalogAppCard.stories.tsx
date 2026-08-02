import {AppCard, AppLogo} from "@agenta/entity-ui/drawers/shared"
import {EntityCard} from "@agenta/ui"
import {Lightning} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tooltip as AntTooltip} from "antd"

// AppCard — the Composio catalog provider tile. The antd cell replays the pre-migration body
// verbatim from feat/storybook-data-seam: same EntityCard (already antd-free), but the
// connected/pending status dot wrapped in an antd Tooltip. At rest the halves should be
// pixel-identical; the swap only changes the (hover-only) tooltip implementation.
const meta = {
    title: "@agenta/entity-ui/Drawers/CatalogAppCard",
    component: AppCard,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Provider tile shared by the trigger and tool catalogs. Only antd `Tooltip` (on the status dot) was swapped for the `@agenta/ui` Tooltip.",
            },
        },
    },
} satisfies Meta<typeof AppCard>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** Pre-migration AppCard body, verbatim (antd Tooltip around the status dot). */
const AntdAppCard = ({
    name,
    description,
    categories,
    actionsCount,
    connected,
    pending,
    variant = "bordered",
}: {
    name: string
    description?: string | null
    categories?: string[]
    actionsCount?: number | null
    connected?: boolean
    pending?: boolean
    variant?: "bordered" | "subtle"
}) => (
    <EntityCard
        variant={variant}
        onClick={noop}
        icon={<AppLogo logo={undefined} size={28} />}
        title={name}
        titleAdornment={
            connected ? (
                <AntTooltip title="Connected">
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--ag-colorSuccess)]" />
                </AntTooltip>
            ) : pending ? (
                <AntTooltip title="Connection pending — finish or retry connecting">
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--ag-colorWarning)]" />
                </AntTooltip>
            ) : null
        }
        description={description}
        tags={categories}
        meta={
            typeof actionsCount === "number" && actionsCount > 0 ? (
                <span className="flex items-center gap-1 text-[10px] text-[var(--ag-colorTextTertiary)]">
                    <Lightning size={11} weight="fill" />
                    {actionsCount}
                </span>
            ) : undefined
        }
    />
)

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[260px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[260px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {name: "GitHub", onClick: noop},
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="connected"
                a={
                    <AntdAppCard
                        name="GitHub"
                        description="Repos, issues and pull requests"
                        categories={["Developer Tools", "CRM"]}
                        actionsCount={42}
                        connected
                    />
                }
                s={
                    <AppCard
                        name="GitHub"
                        description="Repos, issues and pull requests"
                        categories={["developer tools", "crm"]}
                        actionsCount={42}
                        connected
                        onClick={noop}
                    />
                }
            />
            <Row
                label="pending"
                a={<AntdAppCard name="Slack" description="Messages and channels" pending />}
                s={
                    <AppCard
                        name="Slack"
                        description="Messages and channels"
                        pending
                        onClick={noop}
                    />
                }
            />
            <Row
                label="plain · subtle variant"
                a={<AntdAppCard name="Linear" variant="subtle" actionsCount={7} />}
                s={<AppCard name="Linear" variant="subtle" actionsCount={7} onClick={noop} />}
            />
        </div>
    ),
}
