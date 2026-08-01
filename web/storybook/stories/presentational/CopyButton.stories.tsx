import {CopyButton} from "@agenta/ui/components/presentational"
import {Copy} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button} from "antd"

// CopyButton — facade over the @agenta/ui Button (variant="outline") that copies text and
// swaps to a check icon after copying.
//
// The antd half reproduces the ACTUAL pre-migration component (see git e29e3f8586^):
// `<Button icon={<Copy size={14}/>}>{buttonText}</Button>`. It carried the same Phosphor
// icon at the same 14px. An @ant-design/icons `CopyOutlined` would render at the button's
// 12px font-size, so it would report both a bogus 2px width delta and a permanent
// glyph-shape mismatch — neither of which is a component regression.
const meta = {
    title: "@agenta/ui/Presentational/Buttons/CopyButton",
    component: CopyButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Facade over the @agenta/ui Button (variant="outline") that copies text and swaps to a check icon after copying. Replaces an antd Button with a copy icon.\n\n**Used in:** 14 places — agent chat markdown and the inspector rows/lenses, the trace span drill-in and trace drawer accordion, the drives explorer, the dynamic code block, eval-run cell popovers, the webhook secret reveal, the tracing setup and create-testset-from-API modals, and two agent config drill-in controls.',
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
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

// Every icon row is opted out of the pixel gate ("not reproduced"), and only for the icon's
// VERTICAL position. antd applies `resetIcon()` (antd/lib/style/index.js L27-46) to
// `.ant-btn-icon > svg` (wired at antd/lib/button/style/index.js L48): `vertical-align:
// -0.125em`. `.ant-btn` never sets `line-height`, so it keeps the UA `font` shorthand's
// `normal` — the icon wrapper's line box becomes the union of the 14px strut and the icon
// pushed 1.5px below the baseline = 15.5px, with the 14px svg pinned to its TOP. Centring
// 15.5px in the 26px content box puts antd's icon at 6.25px instead of 7.00px. Measured on
// antd 6.3.7 with its own extracted CSS; identical 0.75px lift on the 24px small button.
// We centre the icon exactly, so this is antd being off-centre, not a migration regression:
// re-aligning the crops by that offset drops the residual to 0-2px of 3136.
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="text + icon — icon lift not reproduced (see icon-only row)"
                a={<Button icon={<Copy size={14} />}>Copy</Button>}
                s={<CopyButton text="hello world" icon />}
            />
            <Row
                label="text only"
                a={<Button>Copy</Button>}
                s={<CopyButton text="hello world" />}
            />
            <Row
                label="icon only — 0.75px icon lift not reproduced (antd is off-centre)"
                a={<Button icon={<Copy size={14} />} />}
                s={<CopyButton text="hello world" icon buttonText={null} size="icon" />}
            />
            <Row
                label="custom label — icon lift not reproduced (see icon-only row)"
                a={<Button icon={<Copy size={14} />}>Copy Code</Button>}
                s={<CopyButton text="const x = 1" icon buttonText="Copy Code" />}
            />
        </div>
    ),
}
