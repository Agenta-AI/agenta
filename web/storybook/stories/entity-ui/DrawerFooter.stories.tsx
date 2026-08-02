import {DrawerFooter} from "@agenta/entity-ui/drawers/shared"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Divider as AntDivider, Switch as AntSwitch} from "antd"

// DrawerFooter — the shared entity-config drawer footer. The antd cell replays the
// pre-migration body (antd Divider/Switch/Button incl. `loading`) verbatim from
// feat/storybook-data-seam; the agenta cell renders the migrated component.
const meta = {
    title: "@agenta/entity-ui/Drawers/DrawerFooter",
    component: DrawerFooter,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Shared footer for entity config drawers (Cancel / run slot / Save right, Active toggle or `left` slot left). antd `Divider`/`Switch`/`Button loading` → `@agenta/ui` `Divider`/`Switch`/`LoadingButton`.",
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

/** The pre-migration DrawerFooter body, verbatim (antd Divider + Switch + Button). */
const AntdDrawerFooter = ({
    enabled,
    onEnabledChange,
    left,
    onCancel,
    run,
    isMutating,
    canSave,
    submitLabel,
    onSubmit,
}: FooterArgs) => (
    <>
        <AntDivider className="!m-0" />
        <div className="flex shrink-0 items-center justify-between gap-2 px-6 py-3">
            <div className="flex items-center gap-2">
                {onEnabledChange ? (
                    <>
                        <AntSwitch checked={enabled} onChange={onEnabledChange} />
                        <span className="text-xs text-[var(--ag-colorTextSecondary)]">Active</span>
                    </>
                ) : (
                    left
                )}
            </div>
            <div className="flex items-center gap-2">
                <AntButton onClick={onCancel}>Cancel</AntButton>
                {run}
                <AntButton
                    type="primary"
                    loading={isMutating}
                    disabled={!canSave}
                    onClick={onSubmit}
                >
                    {submitLabel}
                </AntButton>
            </div>
        </div>
    </>
)

const noop = () => undefined

const Row = ({label, args}: {label: string; args: FooterArgs}) => (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[420px]" data-vrt-subject>
                <AntdDrawerFooter {...args} />
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[420px]" data-vrt-subject>
                <DrawerFooter {...args} />
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
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
