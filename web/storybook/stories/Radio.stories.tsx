import {RadioGroup, RadioGroupItem} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Radio as AntRadio} from "antd"

// Phase-0 parity story: the REAL antd Radio behind the app theme, side by side with the
// @agenta/ui re-skin. antd `Radio.Group value onChange options` → `RadioGroup value onValueChange`.
const meta = {
    title: "@agenta/ui/Primitives/Forms/Radio",
    component: AntRadio.Group,
    subcomponents: {"RadioGroup (@agenta/ui)": RadioGroup, RadioGroupItem},
    parameters: {
        docs: {
            description: {
                component:
                    "antd `Radio.Group` (interactive reference) shown beside the `@agenta/ui` RadioGroup/RadioGroupItem that replace it. See the subcomponent tables below for the agenta props.\n\n**Used in:** nowhere — `RadioGroup` and `RadioGroupItem` have zero call-sites.",
            },
        },
    },
} satisfies Meta<typeof AntRadio.Group>

export default meta
type Story = StoryObj<typeof meta>

const OPTIONS = [
    {label: "Option A", value: "a"},
    {label: "Option B", value: "b"},
    {label: "Option C", value: "c"},
]

// @agenta/ui group with labels beside each radio — reproduces antd's `.ant-radio-wrapper` box:
// 20px line box (leading-5, the nbsp ::after), label span px-2 (8px BOTH sides), and the
// non-last wrapper's 8px margin-inline-end (mr-2 last:mr-0).
const ShadGroup = ({value, disabled}: {value?: string; disabled?: boolean}) => (
    <RadioGroup value={value} disabled={disabled}>
        {OPTIONS.map((o) => (
            <label
                key={o.value}
                // antd's disabled wrapper also greys the LABEL text (colorTextDisabled).
                className={`mr-2 flex items-center text-xs leading-5 last:mr-0 ${disabled ? "text-colorTextDisabled" : "text-colorText"}`}
            >
                <RadioGroupItem value={o.value} />
                <span className="px-2">{o.label}</span>
            </label>
        ))}
    </RadioGroup>
)

// Bare-radio parity box: antd's label-less `.ant-radio-wrapper` is still 16x20 (its nbsp
// ::after line box), so the story reproduces that 20px box around the 16px circle.
const SINGLE_BOX = "h-5 justify-center"

// `.grid` Row: [label | antd cell | agenta cell] — the VRT pairs the control in each cell.
// FIXED (not `1fr`) column widths: `1fr` resolves to a fractional px width, so the two cells
// land on DIFFERENT sub-pixel phases and a 16px circle's edge anti-aliases differently on each
// side — several % of "diff" on a control that is byte-identical in geometry and colour. Integer
// tracks put both subjects at the same fractional offset, so the AA cancels.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_14rem_14rem] items-start gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-start gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject wrapper: group rows hold several radios (many subject candidates) */}
            <span data-vrt-subject className="inline-flex">
                {a}
            </span>
        </div>
        <div className="flex items-start gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            <span data-vrt-subject className="inline-flex">
                {s}
            </span>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex w-[688px] flex-col">
            <Row
                label="group · 2nd selected"
                a={<AntRadio.Group value="b" options={OPTIONS} className="flex flex-col gap-2" />}
                s={<ShadGroup value="b" />}
            />
            <Row
                label="group · disabled"
                a={
                    <AntRadio.Group
                        value="b"
                        disabled
                        options={OPTIONS}
                        className="flex flex-col gap-2"
                    />
                }
                s={<ShadGroup value="b" disabled />}
            />
            <Row
                label="single · unchecked"
                a={<AntRadio />}
                s={
                    <RadioGroup className={SINGLE_BOX}>
                        <RadioGroupItem value="x" aria-label="Option" />
                    </RadioGroup>
                }
            />
            <Row
                label="single · checked"
                a={<AntRadio checked />}
                s={
                    <RadioGroup value="x" className={SINGLE_BOX}>
                        <RadioGroupItem value="x" aria-label="Option" />
                    </RadioGroup>
                }
            />
            <Row
                label="single · disabled + checked"
                a={<AntRadio checked disabled />}
                s={
                    <RadioGroup value="x" disabled className={SINGLE_BOX}>
                        <RadioGroupItem value="x" aria-label="Option" />
                    </RadioGroup>
                }
            />
        </div>
    ),
}

// Interaction states forced STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, forcing that pseudo-class on the control inside (antd via
// CSS :hover/:focus-visible, agenta identically) — measurable with no cursor/keyboard.
const StateRow = ({
    label,
    pseudo,
    antd,
    shad,
    expected,
}: {
    label: string
    pseudo: string
    antd: React.ReactNode
    shad: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[16rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${pseudo} flex items-center gap-2`} data-side="antd">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            {/* subject INSIDE the pseudo wrapper so the crop keeps the forced state */}
            <span data-vrt-subject className="inline-flex">
                {antd}
            </span>
        </div>
        <div className={`${pseudo} flex items-center gap-2`} data-side="agenta">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            <span data-vrt-subject className="inline-flex">
                {shad}
            </span>
        </div>
    </div>
)

// single @agenta/ui radio in the given state (wrapped in a RadioGroup as Radix requires).
const ShadOne = ({checked, disabled}: {checked?: boolean; disabled?: boolean}) => (
    <RadioGroup value={checked ? "x" : undefined} disabled={disabled} className={SINGLE_BOX}>
        <RadioGroupItem value="x" aria-label="Option" />
    </RadioGroup>
)

// All rows gated. These once flagged in dark because the pseudo-states addon's one-shot
// stylesheet rewrite raced antd's async cssinjs injection, leaving the antd half at its RESTING
// state. That is now detected and retried in vrt.mjs, so no row needs declaring — the tokens
// always matched (antd's radio CSS is byte-identical light/dark, same cssinjs hash).
export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <StateRow
                label="unchecked · hover"
                pseudo="pseudo-hover-all"
                antd={<AntRadio />}
                shad={<ShadOne />}
            />
            <StateRow
                label="checked · hover"
                pseudo="pseudo-hover-all"
                antd={<AntRadio checked />}
                shad={<ShadOne checked />}
            />
            <StateRow
                label="unchecked · focus-visible"
                pseudo="pseudo-focus-visible-all"
                antd={<AntRadio />}
                shad={<ShadOne />}
            />
            <StateRow
                label="checked · focus-visible"
                pseudo="pseudo-focus-visible-all"
                antd={<AntRadio checked />}
                shad={<ShadOne checked />}
            />
            <StateRow
                label="unchecked · disabled"
                pseudo=""
                antd={<AntRadio disabled />}
                shad={<ShadOne disabled />}
            />
            <StateRow
                label="checked · disabled"
                pseudo=""
                antd={<AntRadio checked disabled />}
                shad={<ShadOne checked disabled />}
            />
        </div>
    ),
}
