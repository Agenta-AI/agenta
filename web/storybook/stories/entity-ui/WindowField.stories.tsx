import {utcIsoToLocalFace} from "@agenta/entities/gatewayTrigger"
import {WindowField} from "@agenta/entity-ui/gatewayTrigger"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {DatePicker as AntDatePicker, Typography as AntTypography} from "antd"

// WindowField — the schedule drawer's optional [start, end) window. The antd cell replays
// the pre-migration body verbatim from feat/storybook-data-seam (antd `DatePicker showTime`).
// The agenta cell renders the migrated component, which uses the shared gatewayTool
// `DateTimeInput` (a native `datetime-local` on the Input primitive) because no
// @agenta/ui calendar primitive exists — a DECLARED deviation: the closed control keeps
// the Input chrome and value face, but the browser's native empty-value template replaces
// antd's "Unbounded" placeholder and the popup calendar is the OS one.
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/WindowField",
    component: WindowField,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "antd `DatePicker showTime` → shared `DateTimeInput` (native `datetime-local` on the `@agenta/ui` Input). No calendar primitive exists in @agenta/ui; the native picker replaces antd's popup. Empty state shows the browser template instead of the `Unbounded` placeholder — the hint line carries that semantics.",
            },
        },
    },
} satisfies Meta<typeof WindowField>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** Pre-migration body, verbatim. */
const AntdWindowField = ({
    startTime,
    endTime,
}: {
    startTime: string | null
    endTime: string | null
}) => (
    <div className="flex flex-col gap-2">
        <div className="flex gap-3">
            <div className="flex w-[116px] shrink-0 flex-col gap-2">
                <span className="flex h-8 items-center px-2.5 text-xs text-[var(--ag-colorTextSecondary)]">
                    Start
                </span>
                <span className="flex h-8 items-center px-2.5 text-xs text-[var(--ag-colorTextSecondary)]">
                    End
                </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                <AntDatePicker
                    showTime={{format: "HH:mm"}}
                    format="YYYY-MM-DD HH:mm"
                    placeholder="Unbounded"
                    className="w-full max-w-prose"
                    value={utcIsoToLocalFace(startTime)}
                />
                <AntDatePicker
                    showTime={{format: "HH:mm"}}
                    format="YYYY-MM-DD HH:mm"
                    placeholder="Unbounded"
                    className="w-full max-w-prose"
                    value={utcIsoToLocalFace(endTime)}
                />
            </div>
        </div>
        <AntTypography.Text type="secondary" className="!text-[11px] leading-snug">
            Schedule fires only within [start, end). Leave either empty for no bound; past end
            auto-stops it.
        </AntTypography.Text>
    </div>
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
    expected: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[420px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[420px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {startTime: null, endTime: null, onChangeStart: noop, onChangeEnd: noop},
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="unbounded (empty)"
                expected="native datetime-local replaces antd DatePicker (no @agenta/ui calendar primitive): empty state shows the browser's value template + stepper, not the 'Unbounded' placeholder + calendar icon"
                a={<AntdWindowField startTime={null} endTime={null} />}
                s={
                    <WindowField
                        startTime={null}
                        endTime={null}
                        onChangeStart={noop}
                        onChangeEnd={noop}
                    />
                }
            />
            <Row
                label="bounded window"
                expected="native datetime-local replaces antd DatePicker: same Input chrome and value face, but native suffix controls instead of antd's calendar/clear icons"
                a={
                    <AntdWindowField
                        startTime="2026-08-01T09:00:00Z"
                        endTime="2026-09-01T18:30:00Z"
                    />
                }
                s={
                    <WindowField
                        startTime="2026-08-01T09:00:00Z"
                        endTime="2026-09-01T18:30:00Z"
                        onChangeStart={noop}
                        onChangeEnd={noop}
                    />
                }
            />
        </div>
    ),
}
