import {EnvironmentStatus, statusMap} from "@agenta/entity-ui/variant"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Badge as AntBadge, Space as AntSpace, Tooltip as AntTooltip} from "antd"

// EnvironmentStatus — the deployment dots next to a variant name. The antd cell replays
// the pre-migration body verbatim (Space + Tooltip + status `Badge color`); the agenta
// cell renders the migrated component (flex gap-2 + @agenta/ui Tooltip + a 5px dot span —
// antd's status dot is fontSizeSM/2 = 5px here, lifted -1px).
// The component reads the environment molecule only as a FALLBACK when `deployedIn` is
// absent; with `deployedIn` passed it renders from props (no fixture needed).
const meta = {
    title: "@agenta/entity-ui/Variant/EnvironmentStatus",
    component: EnvironmentStatus,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Deployment environment dots (production/staging/development). antd status `Badge` + `Tooltip` + `Space` → dot span + `@agenta/ui` `Tooltip` + flex utilities.",
            },
        },
    },
} satisfies Meta<typeof EnvironmentStatus>

export default meta
type Story = StoryObj<typeof meta>

/** The pre-migration EnvironmentStatus body, verbatim (antd Space/Tooltip/Badge). */
const AntdEnvironmentStatus = ({deployedIn}: {deployedIn: {name: string}[]}) => (
    <AntSpace className="environment-badges ml-1">
        {deployedIn.map((env) => (
            <AntTooltip key={env.name} title={env.name}>
                <div>
                    <AntBadge
                        color={statusMap[env.name]?.badge ?? "transparent"}
                        title={env.name}
                    />
                </div>
            </AntTooltip>
        ))}
    </AntSpace>
)

const Row = ({label, envs}: {label: string; envs: {name: string}[]}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div className="inline-flex" data-vrt-subject>
                <AntdEnvironmentStatus deployedIn={envs} />
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className="inline-flex" data-vrt-subject>
                <EnvironmentStatus variant={{deployedIn: envs}} />
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {variant: {deployedIn: [{name: "production"}]}},
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="production" envs={[{name: "production"}]} />
            <Row
                label="all three environments"
                envs={[{name: "production"}, {name: "staging"}, {name: "development"}]}
            />
            <Row label="unknown env (transparent dot)" envs={[{name: "shadow"}]} />
        </div>
    ),
}
