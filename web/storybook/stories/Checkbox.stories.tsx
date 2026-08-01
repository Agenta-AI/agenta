import {Checkbox as ShadCheckbox} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Checkbox as AntCheckbox} from "antd"

// Phase-0 parity story: the REAL antd Checkbox behind the app theme, side by side with the
// @agenta/ui re-skin. antd `onChange`→`onCheckedChange`, `indeterminate`→`checked="indeterminate"`.
const meta = {
    title: "@agenta/ui/Primitives/Forms/Checkbox",
    component: AntCheckbox,
    subcomponents: {"Checkbox (@agenta/ui)": ShadCheckbox},
    parameters: {
        docs: {
            description: {
                component:
                    "antd `Checkbox` (interactive playground) shown beside the `@agenta/ui` Radix Checkbox that replaces it. See the subcomponent table below for the agenta props.\n\n**Used in:** 1 place — the entity picker popover-cascader variant (`@agenta/entity-ui` `UnifiedEntityPicker/variants/PopoverCascaderVariant.tsx`).",
            },
        },
    },
    args: {defaultChecked: true},
    argTypes: {
        indeterminate: {control: "boolean"},
        disabled: {control: "boolean"},
    },
} satisfies Meta<typeof AntCheckbox>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

// `.grid` Row: [label | antd cell | agenta cell] — the VRT pairs the control in each cell.
// FIXED (not `1fr`) column widths: `1fr` resolves to a fractional px width, so the two cells land
// on DIFFERENT sub-pixel phases and the 16px box's edge anti-aliases differently on each side —
// a couple of % of "diff" on a control whose geometry and colours are identical. Integer tracks
// put both subjects at the same fractional offset, so the AA cancels.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_11rem_11rem] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            <span data-vrt-subject className="inline-flex">
                {a}
            </span>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            <span data-vrt-subject className="inline-flex">
                {s}
            </span>
        </div>
    </div>
)

// Bare-checkbox parity box: antd's label-less `.ant-checkbox-wrapper` is still 16x20 (its nbsp
// ::after line box at the app's 20px line-height), so wrap the bare agenta checkbox the same way.
const SingleBox = ({children}: {children: React.ReactNode}) => (
    <span className="flex h-5 items-center">{children}</span>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex w-[576px] flex-col">
            <Row
                label="unchecked"
                a={<AntCheckbox />}
                s={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" />
                    </SingleBox>
                }
            />
            <Row
                label="checked"
                a={<AntCheckbox defaultChecked />}
                s={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" defaultChecked />
                    </SingleBox>
                }
            />
            <Row
                label="indeterminate"
                a={<AntCheckbox indeterminate />}
                s={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" checked="indeterminate" />
                    </SingleBox>
                }
            />
            <Row
                label="disabled · unchecked"
                a={<AntCheckbox disabled />}
                s={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" disabled />
                    </SingleBox>
                }
            />
            <Row
                label="disabled · checked"
                a={<AntCheckbox disabled defaultChecked />}
                s={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" disabled defaultChecked />
                    </SingleBox>
                }
            />
            <Row
                label="with-label"
                a={<AntCheckbox defaultChecked>Label</AntCheckbox>}
                s={
                    <label className="inline-flex cursor-pointer items-center text-xs leading-5 text-colorText">
                        <ShadCheckbox aria-label="Option" defaultChecked />
                        <span className="px-2">Label</span>
                    </label>
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
}: {
    label: string
    pseudo: string
    antd: React.ReactNode
    shad: React.ReactNode
}) => (
    <div className="grid grid-cols-[16rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${pseudo} flex items-center gap-2`} data-side="antd">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
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

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <StateRow
                label="unchecked · hover"
                pseudo="pseudo-hover-all"
                antd={<AntCheckbox />}
                shad={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" />
                    </SingleBox>
                }
            />
            <StateRow
                label="checked · hover"
                pseudo="pseudo-hover-all"
                antd={<AntCheckbox defaultChecked />}
                shad={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" defaultChecked />
                    </SingleBox>
                }
            />
            <StateRow
                label="unchecked · focus-visible"
                pseudo="pseudo-focus-visible-all"
                antd={<AntCheckbox />}
                shad={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" />
                    </SingleBox>
                }
            />
            <StateRow
                label="checked · focus-visible"
                pseudo="pseudo-focus-visible-all"
                antd={<AntCheckbox defaultChecked />}
                shad={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" defaultChecked />
                    </SingleBox>
                }
            />
            <StateRow
                label="indeterminate"
                pseudo=""
                antd={<AntCheckbox indeterminate />}
                shad={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" checked="indeterminate" />
                    </SingleBox>
                }
            />
            <StateRow
                label="disabled · unchecked"
                pseudo=""
                antd={<AntCheckbox disabled />}
                shad={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" disabled />
                    </SingleBox>
                }
            />
            <StateRow
                label="disabled · checked"
                pseudo=""
                antd={<AntCheckbox disabled defaultChecked />}
                shad={
                    <SingleBox>
                        <ShadCheckbox aria-label="Option" disabled defaultChecked />
                    </SingleBox>
                }
            />
        </div>
    ),
}
