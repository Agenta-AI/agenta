import {ActiveToggle} from "@agenta/entity-ui/gatewayTrigger"
import {Pause, Play} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Tooltip as AntTooltip} from "antd"

// ActiveToggle — the shared play/pause control for trigger subscriptions, schedules and
// webhooks. The antd cell replays the pre-migration body verbatim from
// feat/storybook-data-seam: `<Tooltip><Button type="text" size="small" loading icon/></Tooltip>`.
// The agenta cell renders the migrated component (LoadingButton variant="ghost"
// size="icon-sm" + Radix Tooltip).
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/ActiveToggle",
    component: ActiveToggle,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Play/pause lifecycle toggle. antd `Button type="text" size="small" icon loading` + `Tooltip` → `@agenta/ui` `LoadingButton variant="ghost" size="icon-sm"` + Radix Tooltip. The `size` prop is retyped from antd size names to `ButtonProps["size"]` (no call site passed it).',
            },
        },
    },
} satisfies Meta<typeof ActiveToggle>

export default meta
type Story = StoryObj<typeof meta>

const resolve = () => Promise.resolve()

/** Pre-migration body, verbatim (message.* wiring omitted — visual states only). */
const AntdActiveToggle = ({
    active,
    disabled,
    loading,
}: {
    active: boolean
    disabled?: boolean
    loading?: boolean
}) => (
    <AntTooltip title={active ? "Pause" : "Resume"}>
        <AntButton
            type="text"
            size="small"
            loading={loading}
            disabled={disabled}
            aria-label={active ? "Pause" : "Resume"}
            aria-pressed={active}
            icon={active ? <Pause size={16} /> : <Play size={16} />}
        />
    </AntTooltip>
)

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {active: true, onToggle: resolve},
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="active (Pause) — antd 0.75px icon lift not chased"
                expected="antd centres the button icon 0.75px above true centre (ant-btn-icon line box); we centre exactly — accepted deviation, see GOTCHAS"
                a={<AntdActiveToggle active />}
                s={<ActiveToggle active onToggle={resolve} />}
            />
            <Row
                label="paused (Resume)"
                expected="antd centres the button icon 0.75px above true centre; we centre exactly — accepted deviation"
                a={<AntdActiveToggle active={false} />}
                s={<ActiveToggle active={false} onToggle={resolve} />}
            />
            <Row
                label="disabled"
                expected="antd centres the button icon 0.75px above true centre; we centre exactly — accepted deviation"
                a={<AntdActiveToggle active disabled />}
                s={<ActiveToggle active disabled onToggle={resolve} />}
            />
        </div>
    ),
}
