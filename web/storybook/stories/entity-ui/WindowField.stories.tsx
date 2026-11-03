import {useState} from "react"

import {WindowField} from "@agenta/entity-ui/gatewayTrigger"
import type {Meta, StoryObj} from "@storybook/nextjs"

// WindowField — the schedule drawer's optional [start, end) bounds, under Advanced. Each row is
// one shadcn DateTimePicker (Calendar popover + time field sharing a value), so a window keeps
// the precision the stored UTC instant carries.
//
// The antd `DatePicker showTime` parity harness this file used to carry retired once @agenta/ui
// gained a real Calendar primitive — there is no longer a native-input deviation to document.
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/WindowField",
    component: WindowField,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Optional UTC start/end bounds. A tick fires at or after start and strictly before end; either side empty means unbounded.",
            },
        },
    },
} satisfies Meta<typeof WindowField>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, start, end}: {label: string; start: string | null; end: string | null}) => {
    const [startTime, setStartTime] = useState(start)
    const [endTime, setEndTime] = useState(end)
    return (
        <div className="grid grid-cols-[9rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-4">
            <span className="text-xs text-colorTextSecondary">{label}</span>
            <div className="max-w-[420px]">
                <WindowField
                    startTime={startTime}
                    endTime={endTime}
                    onChangeStart={setStartTime}
                    onChangeEnd={setEndTime}
                />
            </div>
        </div>
    )
}

export const Bounds: Story = {
    args: {
        startTime: null,
        endTime: null,
        onChangeStart: () => undefined,
        onChangeEnd: () => undefined,
    },
    render: () => (
        <div className="flex flex-col">
            <Row label="Unbounded" start={null} end={null} />
            <Row label="Start only" start="2026-08-17T09:00:00.000Z" end={null} />
            <Row
                label="Both, mid-day"
                start="2026-08-17T09:30:00.000Z"
                end="2026-09-17T17:45:00.000Z"
            />
        </div>
    ),
}
