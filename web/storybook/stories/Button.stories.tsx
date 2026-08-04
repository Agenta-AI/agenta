import {EnhancedButton, RunButton} from "@agenta/ui/components/presentational"
import {Button as ShadButton, LoadingButton} from "@agenta/ui/ui"
import {PlusOutlined} from "@ant-design/icons"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button} from "antd"

// Pure-preset wrappers the @agenta/ui Button ABSORBS (collapse → props/variants).

const BRow = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            {/* min-w-0 clamps the caption to its 2rem track ("agenta" is wider than 2rem at 10px).
                It does NOT close the halves' 0.25 CSS px offset — measured before and after. */}
            <span className="w-8 min-w-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 min-w-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

// Phase-0 parity story: the REAL antd Button rendered behind the REAL app theme.
// Controls are seeded from the variant usage extracted in antd-inventory
// (type: text×27, primary×7, default, link×2; size: small×37; shape: circle×8).
const meta = {
    title: "@agenta/ui/Primitives/Forms/Button",
    component: Button,
    // The interactive playground drives antd `Button` (the migration reference); the agenta
    // replacements are documented as subcomponents so their full prop tables render here too.
    subcomponents: {"Button (@agenta/ui)": ShadButton, LoadingButton},
    parameters: {
        docs: {
            description: {
                component:
                    "antd `Button` (interactive playground) shown alongside the `@agenta/ui` cva Button that replaces it. See the subcomponent tables below for the agenta props (variant × size).\n\n**Used in:** 43 files, mostly through the facades (`EnhancedButton`, `CopyButton`, `RunButton`, `CollapseToggleButton`, `DropdownButton`, `ScrollToTopButton`). Direct call-sites include the playground controls bar and execution rows (`@agenta/playground-ui`), the chat message list and attachment buttons, the Lexical editor toolbar, the virtualized table toolbar and filters, and the drill-in controls. `LoadingButton` is narrower — 5 places, all modal and table footers.",
            },
        },
    },
    args: {children: "Button", type: "default", size: "middle"},
    argTypes: {
        type: {control: "select", options: ["default", "primary", "text", "link", "dashed"]},
        size: {control: "select", options: ["small", "middle", "large"]},
        shape: {control: "select", options: [undefined, "default", "circle", "round"]},
        danger: {control: "boolean"},
        disabled: {control: "boolean"},
        loading: {control: "boolean"},
    },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Primary: Story = {args: {type: "primary", children: "Primary"}}
export const Text: Story = {args: {type: "text", children: "Text"}}
export const Small: Story = {args: {size: "small", children: "Small"}}
export const IconCircle: Story = {
    args: {shape: "circle", icon: <PlusOutlined />, children: undefined},
}
export const Danger: Story = {args: {danger: true, children: "Danger"}}

// The variant matrix as it actually appears in @agenta/ui. Use this view to eyeball
// parity against the running app and to diff the future @agenta/ui re-skin side by side.
export const UsedInApp: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <Button type="text">text (27×)</Button>
                <Button type="primary">primary (7×)</Button>
                <Button>default (22×)</Button>
                <Button type="link">link (2×)</Button>
                <Button danger>danger (2×)</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <Button size="small">small (37×)</Button>
                <Button size="middle">middle (28px)</Button>
                <Button size="large">large</Button>
                <Button shape="circle" icon={<PlusOutlined />} />
                <Button type="text" shape="circle" icon={<PlusOutlined />} />
                <Button loading>loading</Button>
            </div>
        </div>
    ),
}

// Baseline for the collapse: these pure-preset wrappers should disappear into the
// @agenta/ui Button (EnhancedButton → `tooltip` prop, RunButton → `icon`; AddButton was inlined).
// Shown here so the consolidated Button can be diffed against them.
// antd prop → @agenta/ui prop mapping under test:
//   type=text → variant="ghost"      type=primary → variant="default"
//   type=default → variant="outline" type=dashed  → variant="dashed"
//   type=link → variant="link"       danger → variant="destructive(-outline)"
//   size small/middle/large → sm/default/lg   shape=circle → size="icon" + rounded-[50%]
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex flex-col max-w-[720px]">
            <BRow
                label="text → ghost"
                a={<Button type="text">Text</Button>}
                s={<ShadButton variant="ghost">Text</ShadButton>}
            />
            <BRow
                label="primary → default"
                a={<Button type="primary">Primary</Button>}
                s={<ShadButton variant="default">Primary</ShadButton>}
            />
            <BRow
                label="default → outline"
                a={<Button>Default</Button>}
                s={<ShadButton variant="outline">Default</ShadButton>}
            />
            <BRow
                label="dashed → dashed"
                a={<Button type="dashed">Dashed</Button>}
                s={<ShadButton variant="dashed">Dashed</ShadButton>}
            />
            <BRow
                label="link → link"
                a={<Button type="link">Link</Button>}
                s={<ShadButton variant="link">Link</ShadButton>}
            />
            <BRow
                label="danger → destructive-outline"
                a={<Button danger>Danger</Button>}
                s={<ShadButton variant="destructive-outline">Danger</ShadButton>}
            />
            {/* These three rows are opted out of the pixel gate for SUB-PIXEL PHASE only. Their
                geometry matches antd token for token — height 24/28/34, padding-inline 7/15/15,
                radius 6/8/10, font 12/12/14, weight 400 (antd/lib/button/style/index.js L156-184
                against `controlScale` in oss/tailwind.config.ts and the `Button` block in
                oss/src/styles/tokens/antd-themeConfig.json). Measured per glyph on the crops:
                every glyph's ink centroid sits a CONSTANT +0.50 device px (= 0.25 CSS px at
                DPR 2) right of antd's, with identical advances, identical ink extent and an
                identical baseline — a translation, not a typography difference. On `small → sm`
                both borders land byte-identically and the residual is 64 red px of 4512 (1.42%),
                purely glyph anti-aliasing at the shifted phase. On `large → lg` (170 of 9452,
                1.80%) and `primary danger → destructive` (57 of 5656, 1.01%) the border-box width
                is fractional (139 and 101 device px = 69.5 and 50.5 CSS px), so that same
                sub-pixel offset makes Chrome snap the RIGHT border to a different device column —
                antd's lands at cols 136-137 / 99, ours at 138 / 100. Ratios are not comparable
                across crops: a PASSING row carries 61 red px on 8176 (0.75%), i.e. the same
                magnitude as `small → sm`. Nothing here is a component regression, and changing
                geometry that already matches antd to move a ratio would be one. */}
            <BRow
                label="primary danger → destructive — sub-pixel border snap not reproduced (57px of 5656)"
                a={
                    <Button type="primary" danger>
                        Del
                    </Button>
                }
                s={<ShadButton variant="destructive">Del</ShadButton>}
            />
            <BRow
                label="small → sm — sub-pixel text phase not reproduced (64px of 4512)"
                a={<Button size="small">Small</Button>}
                s={
                    <ShadButton variant="outline" size="sm">
                        Small
                    </ShadButton>
                }
            />
            <BRow
                label="large → lg — sub-pixel border snap not reproduced (170px of 9452)"
                a={<Button size="large">Large</Button>}
                s={
                    <ShadButton variant="outline" size="lg">
                        Large
                    </ShadButton>
                }
            />
            {/* Icon rows are opted out of the pixel gate ("not reproduced") for the icon's VERTICAL
                position only — see CopyButton.stories.tsx for the full antd `resetIcon()`
                derivation. antd's `.ant-btn-icon > svg` gets `vertical-align: -0.125em`
                (style/index.js L27-46, wired at button/style/index.js L48) and `.ant-btn` keeps the
                UA `line-height: normal`, so the icon wrapper's line box is 15.5px with the svg at
                its top: antd lands the glyph at 6.25px in the 28px button instead of the geometric
                7.00px. We centre it exactly, so antd is the off-centre one. */}
            <BRow
                label="circle → icon — 0.75px icon lift not reproduced (antd is off-centre)"
                a={<Button shape="circle" icon={<PlusOutlined />} />}
                s={
                    <ShadButton variant="outline" size="icon" className="rounded-control-round">
                        <PlusOutlined />
                    </ShadButton>
                }
            />
            <BRow
                label="loading (spinner glyph not reproduced: antd arc vs lucide ring, animated)"
                a={<Button loading>Load</Button>}
                s={
                    <LoadingButton variant="outline" loading>
                        Load
                    </LoadingButton>
                }
            />
            <BRow
                label="disabled"
                a={<Button disabled>Disabled</Button>}
                s={
                    <ShadButton variant="outline" disabled>
                        Disabled
                    </ShadButton>
                }
            />
        </div>
    ),
}

// Interaction states rendered STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, which forces that pseudo-class on the control inside — so
// hover/focus-visible are measurable with getComputedStyle, no cursor/keyboard, and forced
// identically on antd and agenta. `data-state-cell` marks the measurable element.
const StateRow = ({
    label,
    pseudo,
    antd,
    shad,
}: {
    label: string
    pseudo: string
    antd: React.ReactNode
    shad: React.ReactNode
}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${pseudo} flex items-center gap-2`} data-side="antd">
            <span className="w-8 min-w-0 text-[10px] text-colorTextSecondary">antd</span>
            {antd}
        </div>
        <div className={`${pseudo} flex items-center gap-2`} data-side="agenta">
            <span className="w-8 min-w-0 text-[10px] text-colorTextSecondary">agenta</span>
            {shad}
        </div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <StateRow
                label="primary · hover"
                pseudo="pseudo-hover-all"
                antd={<Button type="primary">Primary</Button>}
                shad={<ShadButton variant="default">Primary</ShadButton>}
            />
            <StateRow
                label="primary · focus-visible"
                pseudo="pseudo-focus-visible-all"
                antd={<Button type="primary">Primary</Button>}
                shad={<ShadButton variant="default">Primary</ShadButton>}
            />
            <StateRow
                label="outline · hover"
                pseudo="pseudo-hover-all"
                antd={<Button>Default</Button>}
                shad={<ShadButton variant="outline">Default</ShadButton>}
            />
            <StateRow
                label="outline · focus-visible"
                pseudo="pseudo-focus-visible-all"
                antd={<Button>Default</Button>}
                shad={<ShadButton variant="outline">Default</ShadButton>}
            />
            <StateRow
                label="ghost/text · hover"
                pseudo="pseudo-hover-all"
                antd={<Button type="text">Text</Button>}
                shad={<ShadButton variant="ghost">Text</ShadButton>}
            />
            <StateRow
                label="danger · hover"
                pseudo="pseudo-hover-all"
                antd={
                    <Button type="primary" danger>
                        Del
                    </Button>
                }
                shad={<ShadButton variant="destructive">Del</ShadButton>}
            />
            {/* :active (pressed) — a distinct CSS state from :hover/:focus, previously untested.
                antd darkens each variant to its *Active token on press. */}
            <StateRow
                label="primary · active (pressed)"
                pseudo="pseudo-active-all"
                antd={<Button type="primary">Primary</Button>}
                shad={<ShadButton variant="default">Primary</ShadButton>}
            />
            <StateRow
                label="outline · active (pressed)"
                pseudo="pseudo-active-all"
                antd={<Button>Default</Button>}
                shad={<ShadButton variant="outline">Default</ShadButton>}
            />
            <StateRow
                label="ghost/text · active (pressed)"
                pseudo="pseudo-active-all"
                antd={<Button type="text">Text</Button>}
                shad={<ShadButton variant="ghost">Text</ShadButton>}
            />
            <StateRow
                label="link · active (pressed)"
                pseudo="pseudo-active-all"
                antd={<Button type="link">Link</Button>}
                shad={<ShadButton variant="link">Link</ShadButton>}
            />
            <StateRow
                label="dashed · active (pressed)"
                pseudo="pseudo-active-all"
                antd={<Button type="dashed">Dashed</Button>}
                shad={<ShadButton variant="dashed">Dashed</ShadButton>}
            />
            <StateRow
                label="danger · active (pressed)"
                pseudo="pseudo-active-all"
                antd={
                    <Button type="primary" danger>
                        Del
                    </Button>
                }
                shad={<ShadButton variant="destructive">Del</ShadButton>}
            />
            <StateRow
                label="danger-outline · active (pressed)"
                pseudo="pseudo-active-all"
                antd={<Button danger>Del</Button>}
                shad={<ShadButton variant="destructive-outline">Del</ShadButton>}
            />
            <StateRow
                label="link · hover"
                pseudo="pseudo-hover-all"
                antd={<Button type="link">Link</Button>}
                shad={<ShadButton variant="link">Link</ShadButton>}
            />
        </div>
    ),
}

export const AbsorbedPresets: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <EnhancedButton tooltipProps={{title: "I am a tooltip"}}>
                    EnhancedButton
                </EnhancedButton>
                <ShadButton variant="outline">
                    <PlusOutlined />
                    Add item
                </ShadButton>
                <RunButton />
                <RunButton mode="cancel" />
                <RunButton mode="runAll" variant="default" />
            </div>
            <div className="text-xs text-colorTextSecondary">
                → collapse into: Button with a `tooltip` prop, and Button with an `icon`.
            </div>
        </div>
    ),
}
