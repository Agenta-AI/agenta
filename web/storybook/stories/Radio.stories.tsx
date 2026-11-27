import {RadioGroup, RadioGroupItem} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Radio",
    component: RadioGroup,
    subcomponents: {RadioGroupItem},
    parameters: {
        docs: {
            description: {
                component:
                    "A Radix RadioGroup with RadioGroupItem. Use `value` and `onValueChange` on the group. See the subcomponent table below for the item props.\n\n**Used in:** nowhere — `RadioGroup` and `RadioGroupItem` have zero call-sites.",
            },
        },
    },
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

const OPTIONS = [
    {label: "Option A", value: "a"},
    {label: "Option B", value: "b"},
    {label: "Option C", value: "c"},
]

// A group with labels beside each radio: 20px line box (leading-5), label span px-2 (8px both
// sides), and an 8px margin-inline-end on every item but the last (mr-2 last:mr-0).
const ShadGroup = ({value, disabled}: {value?: string; disabled?: boolean}) => (
    <RadioGroup value={value} disabled={disabled}>
        {OPTIONS.map((o) => (
            <label
                key={o.value}
                // A disabled group also greys the LABEL text (colorTextDisabled).
                className={`mr-2 flex items-center text-xs leading-5 last:mr-0 ${disabled ? "text-colorTextDisabled" : "text-colorText"}`}
            >
                <RadioGroupItem value={o.value} />
                <span className="px-2">{o.label}</span>
            </label>
        ))}
    </RadioGroup>
)

// A bare radio sits in a 20px-high box around the 16px circle.
const SINGLE_BOX = "h-5 justify-center"

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_14rem] items-start gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-start gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex w-[480px] flex-col">
            <Row label="group · 2nd selected">
                <ShadGroup value="b" />
            </Row>
            <Row label="group · disabled">
                <ShadGroup value="b" disabled />
            </Row>
            <Row label="single · unchecked">
                <RadioGroup className={SINGLE_BOX}>
                    <RadioGroupItem value="x" aria-label="Option" />
                </RadioGroup>
            </Row>
            <Row label="single · checked">
                <RadioGroup value="x" className={SINGLE_BOX}>
                    <RadioGroupItem value="x" aria-label="Option" />
                </RadioGroup>
            </Row>
            <Row label="single · disabled + checked">
                <RadioGroup value="x" disabled className={SINGLE_BOX}>
                    <RadioGroupItem value="x" aria-label="Option" />
                </RadioGroup>
            </Row>
        </div>
    ),
}

// Interaction states forced STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, forcing that pseudo-class on the control inside.
const StateRow = ({
    label,
    pseudo,
    children,
}: {
    label: string
    pseudo: string
    children: React.ReactNode
}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${pseudo} flex items-center gap-2`}>{children}</div>
    </div>
)

// A single radio in the given state (wrapped in a RadioGroup as Radix requires).
const ShadOne = ({checked, disabled}: {checked?: boolean; disabled?: boolean}) => (
    <RadioGroup value={checked ? "x" : undefined} disabled={disabled} className={SINGLE_BOX}>
        <RadioGroupItem value="x" aria-label="Option" />
    </RadioGroup>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <StateRow label="unchecked · hover" pseudo="pseudo-hover-all">
                <ShadOne />
            </StateRow>
            <StateRow label="checked · hover" pseudo="pseudo-hover-all">
                <ShadOne checked />
            </StateRow>
            <StateRow label="unchecked · focus-visible" pseudo="pseudo-focus-visible-all">
                <ShadOne />
            </StateRow>
            <StateRow label="checked · focus-visible" pseudo="pseudo-focus-visible-all">
                <ShadOne checked />
            </StateRow>
            <StateRow label="unchecked · disabled" pseudo="">
                <ShadOne disabled />
            </StateRow>
            <StateRow label="checked · disabled" pseudo="">
                <ShadOne checked disabled />
            </StateRow>
        </div>
    ),
}
