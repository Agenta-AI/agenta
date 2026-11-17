import {Checkbox as ShadCheckbox} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Checkbox",
    component: ShadCheckbox,
    parameters: {
        docs: {
            description: {
                component:
                    'A Radix Checkbox. Use `onCheckedChange` for changes and `checked="indeterminate"` for the mixed state.\n\n**Used in:** 1 place — the entity picker popover-cascader variant (`@agenta/entity-ui` `UnifiedEntityPicker/variants/PopoverCascaderVariant.tsx`).',
            },
        },
    },
    args: {defaultChecked: true, "aria-label": "Option"},
    argTypes: {
        disabled: {control: "boolean"},
    },
} satisfies Meta<typeof ShadCheckbox>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_11rem] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

// A bare checkbox sits in a 20px-high line box, like a checkbox with a label.
const SingleBox = ({children}: {children: React.ReactNode}) => (
    <span className="flex h-5 items-center">{children}</span>
)

export const Variants: Story = {
    render: () => (
        <div className="flex w-[360px] flex-col">
            <Row label="unchecked">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" />
                </SingleBox>
            </Row>
            <Row label="checked">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" defaultChecked />
                </SingleBox>
            </Row>
            <Row label="indeterminate">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" checked="indeterminate" />
                </SingleBox>
            </Row>
            <Row label="disabled · unchecked">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" disabled />
                </SingleBox>
            </Row>
            <Row label="disabled · checked">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" disabled defaultChecked />
                </SingleBox>
            </Row>
            <Row label="with-label">
                <label className="inline-flex cursor-pointer items-center text-xs leading-5 text-colorText">
                    <ShadCheckbox aria-label="Option" defaultChecked />
                    <span className="px-2">Label</span>
                </label>
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

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <StateRow label="unchecked · hover" pseudo="pseudo-hover-all">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" />
                </SingleBox>
            </StateRow>
            <StateRow label="checked · hover" pseudo="pseudo-hover-all">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" defaultChecked />
                </SingleBox>
            </StateRow>
            <StateRow label="unchecked · focus-visible" pseudo="pseudo-focus-visible-all">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" />
                </SingleBox>
            </StateRow>
            <StateRow label="checked · focus-visible" pseudo="pseudo-focus-visible-all">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" defaultChecked />
                </SingleBox>
            </StateRow>
            <StateRow label="indeterminate" pseudo="">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" checked="indeterminate" />
                </SingleBox>
            </StateRow>
            <StateRow label="disabled · unchecked" pseudo="">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" disabled />
                </SingleBox>
            </StateRow>
            <StateRow label="disabled · checked" pseudo="">
                <SingleBox>
                    <ShadCheckbox aria-label="Option" disabled defaultChecked />
                </SingleBox>
            </StateRow>
        </div>
    ),
}
