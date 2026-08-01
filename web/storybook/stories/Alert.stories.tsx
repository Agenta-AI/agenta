import {Alert} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Alert as AntAlert} from "antd"

// Phase-0 parity story: the REAL antd Alert behind the app theme, side by side with the
// @agenta/ui re-skin. antd type/message/description/showIcon/closable/banner map 1:1.
const meta = {
    title: "@agenta/ui/Primitives/Display/Alert",
    component: AntAlert,
    subcomponents: {"Alert (@agenta/ui)": Alert},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "antd `Alert` (interactive playground) shown beside the `@agenta/ui` Alert that replaces it. See the subcomponent table below for the agenta props.\n\n**Used in:** nowhere — the `@agenta/ui` Alert has zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
            },
        },
    },
} satisfies Meta<typeof AntAlert>

export default meta
type Story = StoryObj<typeof meta>

// `.grid` Row: [label | antd cell | agenta cell] — the VRT pairs the Alert in each cell.
// Alerts are block-width, so each cell holds a fixed-width box.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject: closable alerts add a button — crop the whole alert */}
            <div className="w-[320px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[320px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row
                label="success · showIcon"
                a={<AntAlert type="success" message="Success message" showIcon />}
                s={<Alert type="success" message="Success message" showIcon />}
            />
            <Row
                label="info · showIcon"
                a={<AntAlert type="info" message="Info message" showIcon />}
                s={<Alert type="info" message="Info message" showIcon />}
            />
            <Row
                label="warning · showIcon"
                a={<AntAlert type="warning" message="Warning message" showIcon />}
                s={<Alert type="warning" message="Warning message" showIcon />}
            />
            <Row
                label="error · showIcon"
                a={<AntAlert type="error" message="Error message" showIcon />}
                s={<Alert type="error" message="Error message" showIcon />}
            />
            <Row
                label="error · description"
                a={
                    <AntAlert
                        type="error"
                        message="Error title"
                        description="A longer description explaining what went wrong."
                        showIcon
                    />
                }
                s={
                    <Alert
                        type="error"
                        message="Error title"
                        description="A longer description explaining what went wrong."
                        showIcon
                    />
                }
            />
            <Row
                label="closable"
                a={<AntAlert type="info" message="Dismissible message" closable />}
                s={<Alert type="info" message="Dismissible message" closable />}
            />
            <Row
                label="banner"
                a={<AntAlert type="warning" message="Banner message" banner />}
                s={<Alert type="warning" message="Banner message" banner />}
            />
            <Row
                label="plain (no icon)"
                a={<AntAlert type="info" message="Plain message" />}
                s={<Alert type="info" message="Plain message" />}
            />
        </div>
    ),
}
