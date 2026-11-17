import {DrawerFooter} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"

// DrawerFooter — the shared entity-config drawer footer.
const meta = {
    title: "@agenta/entity-ui/Drawers/DrawerFooter",
    component: DrawerFooter,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Shared footer for entity config drawers (Cancel / run slot / Save right, Active toggle or `left` slot left).",
            },
        },
    },
} satisfies Meta<typeof DrawerFooter>

export default meta
type Story = StoryObj<typeof meta>

interface FooterArgs {
    enabled?: boolean
    onEnabledChange?: (value: boolean) => void
    left?: React.ReactNode
    onCancel: () => void
    run?: React.ReactNode
    isMutating?: boolean
    canSave: boolean
    submitLabel: string
    onSubmit: () => void
}

const noop = () => undefined

const Row = ({label, args}: {label: string; args: FooterArgs}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[420px]">
            <DrawerFooter {...args} />
        </div>
    </div>
)

export const Variants: Story = {
    args: {onCancel: noop, canSave: true, submitLabel: "Save", onSubmit: noop},
    render: () => (
        <div className="flex max-w-[1100px] flex-col">
            <Row
                label="active toggle · on"
                args={{
                    enabled: true,
                    onEnabledChange: noop,
                    onCancel: noop,
                    canSave: true,
                    submitLabel: "Save",
                    onSubmit: noop,
                }}
            />
            <Row
                label="active toggle · off"
                args={{
                    enabled: false,
                    onEnabledChange: noop,
                    onCancel: noop,
                    canSave: true,
                    submitLabel: "Save",
                    onSubmit: noop,
                }}
            />
            <Row
                label="left slot · no toggle"
                args={{
                    left: (
                        <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                            3 tools selected
                        </span>
                    ),
                    onCancel: noop,
                    canSave: true,
                    submitLabel: "Add",
                    onSubmit: noop,
                }}
            />
            <Row
                label="mutating (loading save)"
                args={{
                    enabled: true,
                    onEnabledChange: noop,
                    onCancel: noop,
                    isMutating: true,
                    canSave: true,
                    submitLabel: "Save",
                    onSubmit: noop,
                }}
            />
            <Row
                label="cannot save (disabled)"
                args={{
                    enabled: false,
                    onEnabledChange: noop,
                    onCancel: noop,
                    canSave: false,
                    submitLabel: "Save",
                    onSubmit: noop,
                }}
            />
        </div>
    ),
}
