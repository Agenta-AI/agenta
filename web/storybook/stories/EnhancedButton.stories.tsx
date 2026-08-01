import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button, Tooltip} from "antd"

// EnhancedButton — an antd Button+Tooltip convenience, now a FACADE over the @agenta/ui Button
// + Radix Tooltip. The antd original it replaces is an antd Tooltip wrapping an antd Button.
//
// BASELINE NOTE: both cells pass the SAME Phosphor `<Plus size={14}/>`. Every real call-site
// feeds this facade a Phosphor icon at 14px (never an `@ant-design/icons` glyph), so the antd
// reference must too — a `<PlusOutlined/>` here is a 12px glyph with different strokes, which
// made the button 2px narrower and reported ~8% "diff" that was purely the icon.
const ICON = <Plus size={14} />

const meta = {
    title: "@agenta/ui/Enhanced/Button",
    component: EnhancedButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The antd-compatible facade over the @agenta/ui Button + Radix Tooltip primitive; keeps antd Button+Tooltip props (type/size/danger/tooltipProps) while rendering the @agenta/ui primitive.\n\n**Used in:** 12 places — the layout breadcrumb sidebar toggle, the observability header, the playground testset drawer and deploy-variant button, the trace drawer accordion panel, the annotate and add-to-testset buttons, the EE audit-log filters, the annotation scenario list, and both playground execution-row layouts.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            {/* min-w-0: without it `min-width:auto` lets "agenta" (>2rem at 10px) widen its own
                caption, putting the two halves on different sub-pixel offsets. */}
            <span className="w-8 min-w-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 min-w-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="default + tooltip + icon"
                a={
                    <Tooltip title="Add a new item">
                        <Button icon={ICON}>Add</Button>
                    </Tooltip>
                }
                s={
                    <EnhancedButton
                        label="Add"
                        icon={ICON}
                        tooltipProps={{title: "Add a new item"}}
                    />
                }
            />
            <Row
                label="primary → default variant"
                a={
                    <Tooltip title="Save changes">
                        <Button type="primary">Save</Button>
                    </Tooltip>
                }
                s={
                    <EnhancedButton
                        type="primary"
                        label="Save"
                        tooltipProps={{title: "Save changes"}}
                    />
                }
            />
            <Row
                label="text → ghost variant"
                a={
                    <Tooltip title="More options">
                        <Button type="text">More</Button>
                    </Tooltip>
                }
                s={
                    <EnhancedButton
                        type="text"
                        label="More"
                        tooltipProps={{title: "More options"}}
                    />
                }
            />
            <Row
                label="danger"
                a={
                    <Tooltip title="Delete">
                        <Button danger>Delete</Button>
                    </Tooltip>
                }
                s={<EnhancedButton danger label="Delete" tooltipProps={{title: "Delete"}} />}
            />
            <Row
                label="small"
                a={
                    <Tooltip title="Small">
                        <Button size="small">Small</Button>
                    </Tooltip>
                }
                s={<EnhancedButton size="small" label="Small" tooltipProps={{title: "Small"}} />}
            />
            <Row
                label="large"
                a={
                    <Tooltip title="Large">
                        <Button size="large">Large</Button>
                    </Tooltip>
                }
                s={<EnhancedButton size="large" label="Large" tooltipProps={{title: "Large"}} />}
            />
            {/* Icon-only is opted out of the pixel gate for the icon's VERTICAL position only — see
                CopyButton.stories.tsx for the antd `resetIcon()` derivation: `.ant-btn-icon > svg`
                gets `vertical-align: -0.125em` and `.ant-btn` keeps `line-height: normal`, so
                antd's glyph lands 0.75px above the button's geometric centre. We centre exactly. */}
            <Row
                label="icon-only (circle) — 0.75px icon lift not reproduced (antd is off-centre)"
                a={
                    <Tooltip title="Add">
                        <Button shape="circle" icon={ICON} />
                    </Tooltip>
                }
                s={<EnhancedButton shape="circle" icon={ICON} tooltipProps={{title: "Add"}} />}
            />
            <Row
                label="no tooltip (bare button)"
                a={<Button icon={ICON}>Add</Button>}
                s={<EnhancedButton label="Add" icon={ICON} />}
            />
        </div>
    ),
}
