import {useState} from "react"

import {ScheduleBuilderField} from "@agenta/entity-ui/gatewayTrigger"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ScheduleBuilderField — the schedule drawer's "Schedule" row. The collapsed control states the
// cadence in words and the next run; the popover behind it holds the cadence chips, the day or
// month selection, the run times, and the raw-cron escape hatch.
//
// The antd parity harness this file used to carry retired with the v2 redesign: the pre-migration
// component was a two-pane rail rendered inline, which the current control no longer resembles.
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/ScheduleBuilderField",
    component: ScheduleBuilderField,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Cron builder over a cron string. The string stays the source of truth: the chips edit the subset the builder can draw, and the Cron preset is the raw editor for anything else.",
            },
        },
    },
} satisfies Meta<typeof ScheduleBuilderField>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, initial}: {label: string; initial: string}) => {
    const [cron, setCron] = useState(initial)
    return (
        <div className="grid grid-cols-[11rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
            <div className="flex flex-col gap-1">
                <span className="text-xs text-colorTextSecondary">{label}</span>
                <code className="text-[11px] text-colorTextDescription">{cron}</code>
            </div>
            <div className="max-w-[420px]">
                <ScheduleBuilderField value={cron} onChange={setCron} />
            </div>
        </div>
    )
}

/** Every cadence the builder can draw, plus the two it deliberately cannot. */
export const Cadences: Story = {
    args: {value: "0 9 * * 1-5", onChange: () => undefined},
    render: () => (
        <div className="flex flex-col">
            <Row label="Weekly, Mon–Fri" initial="0 9 * * 1,2,3,4,5" />
            <Row label="Weekly" initial="0 9 * * 1,3,5" />
            <Row label="Daily" initial="0 9 * * *" />
            <Row label="Daily, two times" initial="0 9,21 * * *" />
            <Row label="Monthly, several days" initial="0 9 1,15 * *" />
            <Row label="Hourly" initial="0 */3 * * *" />
            <Row label="Hourly, off-chip step" initial="0 */5 * * *" />
            <Row label="Not representable → Cron" initial="0 9 1 * 1" />
            <Row label="Invalid" initial="99 9 * * *" />
        </div>
    ),
}
