import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tooltip} from "antd"

// CopyTooltip — wraps its single child in an @agenta/ui Tooltip (Radix) and copies `copyText` on click, briefly
// swapping the tooltip to a "Copied to clipboard" confirmation. The antd baseline this story
// compares against is a plain antd Tooltip (no copy behavior).
const meta = {
    title: "@agenta/ui/Presentational/Feedback/CopyTooltip",
    component: CopyTooltip,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Wraps its single child in an @agenta/ui Tooltip (Radix) and copies `copyText` on click, briefly swapping the tooltip to a confirmation. The antd baseline this story compares against is a plain antd Tooltip with no copy behavior.\n\n**Used in:** 16 places — the layout breadcrumb, observability columns and the sessions table, the trace drawer header/type/linked-spans panels, the session drawer header and message panel, eval-run focus drawer and configuration fields, reference chips and query cells, organization settings, the EE audit-log cells, the annotation session navigation, and the playground tool-call view.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="hover, then click to copy"
                a={
                    <Tooltip title="call_abc123" placement="top">
                        {/* The tooltip TARGET is the parity subject — agenta's resolves via
                            `data-slot=tooltip-trigger`, antd's needs the explicit hook. */}
                        <span
                            data-vrt-subject
                            className="cursor-pointer text-xs text-colorText underline decoration-dotted"
                        >
                            call_abc123
                        </span>
                    </Tooltip>
                }
                s={
                    <CopyTooltip title="Click to copy" copyText="call_abc123">
                        <span className="text-xs text-colorText underline decoration-dotted">
                            call_abc123
                        </span>
                    </CopyTooltip>
                }
            />
        </div>
    ),
}
