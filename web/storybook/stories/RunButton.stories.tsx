import {RunButton} from "@agenta/ui/components/presentational"
import {Button as ShadButton} from "@agenta/ui/ui"
import {PlayIcon, XCircleIcon} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button} from "antd"

// RunButton — facade over the @agenta/ui Button with Play / X-circle icons for run/cancel
// actions. The antd original (e29e3f8586^) carried the SAME phosphor icons at size 14, so the
// baseline uses them: an @ant-design/icons substitute would compare two different glyphs at
// the button's 12px font-size and report a permanent mismatch no component change can close.
const meta = {
    title: "@agenta/ui/Presentational/Buttons/RunButton",
    component: RunButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Facade over the @agenta/ui Button with Play / X-circle icons for run and cancel actions. Replaces an antd Button carrying a play/close icon.\n\n**Used in:** 3 places, all playground (`@agenta/playground-ui`) — the controls bar, the execution header, and the shared execution-row actions.",
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

// Every RunButton renders an icon, so all five product rows are opted out of the pixel gate
// ("not reproduced") for the icon's VERTICAL position only — see CopyButton.stories.tsx for the
// full antd `resetIcon()` derivation: `.ant-btn-icon > svg` gets `vertical-align: -0.125em`
// (antd/lib/style/index.js L27-46, wired at antd/lib/button/style/index.js L48) while `.ant-btn`
// keeps the UA `line-height: normal`, so the icon's line box exceeds the 14px glyph and antd
// hangs it above the button's geometric centre. Measured on these crops: antd's icon is a pure
// integer translation 2 device px (= 1.0 CSS px at DPR 2) ABOVE ours on the 24px small button —
// the per-scanline ink profile of antd at y equals ours at y+2 exactly, and the per-column ink
// profile is byte-identical, so the glyph is the same size and the same horizontal position.
// Ours is the centred one (glyph centre 23.5 of 47.0 device px); antd is off-centre.
//
// `cancel (destructive)` carries the SAME 2px lift and nothing else: sampled through the crops,
// the border (#d61010 light / #dc4446 dark), the fill and the label are byte-identical between
// our `destructive-outline` and antd's `color="danger" variant="outlined"`, and every differing
// pixel falls inside the icon's column band. The red cancel is a deliberate change — the
// ancestor's bare `color` was inert (antd v6 needs color+variant) — and it now matches.
//
// The two chrome rows re-gate everything else. Wrapping the icon in a block-level span means the
// svg is no longer a DIRECT child of `.ant-btn-icon`, so antd's `> svg` rule stops applying and
// antd centres the icon exactly where we do. Both halves render the same wrapper, so size,
// radius, border, fill, label and the icon's horizontal position all stay measured.
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="run — 1px icon lift not reproduced (antd is off-centre)"
                a={
                    <Button className="self-start" size="small" icon={<PlayIcon size={14} />}>
                        Run
                    </Button>
                }
                s={<RunButton />}
            />
            <Row
                label="cancel (destructive) — 1px icon lift not reproduced (antd is off-centre)"
                a={
                    <Button
                        className="self-start"
                        color="danger"
                        variant="outlined"
                        size="small"
                        icon={<XCircleIcon size={14} />}
                    >
                        Cancel
                    </Button>
                }
                s={<RunButton mode="cancel" />}
            />
            <Row
                label="run all — 1px icon lift not reproduced (antd is off-centre)"
                a={
                    <Button className="self-start" size="small" icon={<PlayIcon size={14} />}>
                        Run all
                    </Button>
                }
                s={<RunButton mode="runAll" />}
            />
            <Row
                label="re-run — 1px icon lift not reproduced (antd is off-centre)"
                a={
                    <Button className="self-start" size="small" icon={<PlayIcon size={14} />}>
                        Re run
                    </Button>
                }
                s={<RunButton mode="rerun" />}
            />
            <Row
                label="custom label — 1px icon lift not reproduced (antd is off-centre)"
                a={
                    <Button className="self-start" size="small" icon={<PlayIcon size={14} />}>
                        Evaluate
                    </Button>
                }
                s={<RunButton label="Evaluate" />}
            />
            <Row
                label="chrome · outline (icon wrapped, so antd centres it too)"
                a={
                    <Button
                        className="self-start"
                        size="small"
                        icon={
                            <span className="flex">
                                <PlayIcon size={14} />
                            </span>
                        }
                    >
                        Run
                    </Button>
                }
                s={
                    <ShadButton className="self-start" variant="outline" size="sm">
                        <span className="flex">
                            <PlayIcon size={14} />
                        </span>
                        Run
                    </ShadButton>
                }
            />
            <Row
                label="chrome · destructive-outline (icon wrapped, so antd centres it too)"
                a={
                    <Button
                        className="self-start"
                        color="danger"
                        variant="outlined"
                        size="small"
                        icon={
                            <span className="flex">
                                <XCircleIcon size={14} />
                            </span>
                        }
                    >
                        Cancel
                    </Button>
                }
                s={
                    <ShadButton className="self-start" variant="destructive-outline" size="sm">
                        <span className="flex">
                            <XCircleIcon size={14} />
                        </span>
                        Cancel
                    </ShadButton>
                }
            />
        </div>
    ),
}
