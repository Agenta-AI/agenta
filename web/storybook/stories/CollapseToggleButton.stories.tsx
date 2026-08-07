import {CollapseToggleButton} from "@agenta/ui/components/presentational"
import {Button as ShadButton} from "@agenta/ui/ui"
import {CaretLineDown, CaretLineUp} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button, Tooltip} from "antd"

// CollapseToggleButton — facade over the @agenta/ui Button (size="icon-sm", variant="ghost")
// wrapped in a Tooltip, with CaretLineUp/Down icons + Collapse/Expand labels.
//
// The antd half reproduces the ACTUAL pre-migration component (see git e29e3f8586^):
// `<Tooltip><Button size="small" type="text" icon={<CaretLineUp size={14}/>} /></Tooltip>`.
// It carried the same Phosphor caret — substituting an @ant-design/icons `UpOutlined` here
// would compare two different glyphs and report a permanent ~20% "mismatch" that no
// component change can close, hiding the real chrome deltas underneath it.
const meta = {
    title: "@agenta/ui/Presentational/Buttons/CollapseToggleButton",
    component: CollapseToggleButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Facade over the @agenta/ui Button (variant="ghost") wrapped in a Tooltip, with caret icons and Collapse/Expand labels. Replaces an antd Tooltip + text Button.\n\n**Used in:** 6 places — the agent config drill-in controls (code, schemas and tool items in `@agenta/entity-ui/DrillInView/SchemaControls`), the chat message list, and the playground turn header plus single-layout execution row (via the `@agenta/playground-ui` re-export shim). The component takes no icon prop and no call-site overrides `size`/`iconSize`, so the `CaretLineUp`/`CaretLineDown` carets shown here are exactly what ships.',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
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

// The three real rows are opted out of the pixel gate ("not reproduced") for the icon's
// VERTICAL position only — see the CopyButton story for the full antd `resetIcon()`
// derivation. Short version: antd's `.ant-btn-icon > svg` gets `vertical-align: -0.125em`,
// which makes the icon wrapper's line box 15.5px with the 14px svg at its top, so antd's
// icon lands 0.75px above the button's centre. We centre it exactly.
// The last row re-gates everything else: wrapping the icon in a block-level span means the
// svg is no longer a DIRECT child of `.ant-btn-icon`, so antd's rule stops applying and it
// centres the icon at exactly our position (verified: 5.00px in the 24px button, both
// halves). Both halves render the same wrapper, so size/radius/ghost fill/border/glyph and
// the horizontal position stay measured.
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="expanded (Collapse) — 0.75px icon lift not reproduced (antd is off-centre)"
                a={
                    <Tooltip title="Collapse">
                        <Button type="text" size="small" icon={<CaretLineUp size={14} />} />
                    </Tooltip>
                }
                s={<CollapseToggleButton collapsed={false} onToggle={() => {}} />}
            />
            <Row
                label="collapsed (Expand) — 0.75px icon lift not reproduced (antd is off-centre)"
                a={
                    <Tooltip title="Expand">
                        <Button type="text" size="small" icon={<CaretLineDown size={14} />} />
                    </Tooltip>
                }
                s={<CollapseToggleButton collapsed onToggle={() => {}} />}
            />
            <Row
                label="disabled — 0.75px icon lift not reproduced (antd is off-centre)"
                a={
                    <Tooltip title="Collapse">
                        <Button
                            type="text"
                            size="small"
                            disabled
                            icon={<CaretLineUp size={14} />}
                        />
                    </Tooltip>
                }
                s={<CollapseToggleButton collapsed={false} disabled onToggle={() => {}} />}
            />
            <Row
                label="chrome (icon wrapped, so antd centres it too)"
                a={
                    <Tooltip title="Collapse">
                        <Button
                            type="text"
                            size="small"
                            icon={
                                <span className="flex">
                                    <CaretLineUp size={14} />
                                </span>
                            }
                        />
                    </Tooltip>
                }
                s={
                    <ShadButton size="icon-sm" variant="ghost">
                        <span className="flex">
                            <CaretLineUp size={14} />
                        </span>
                    </ShadButton>
                }
            />
        </div>
    ),
}
