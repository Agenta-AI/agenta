import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {RevertGroupButton} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/RevertGroupButton"

// RevertGroupButton — the section-scoped "Revert" header action from `useModelHarness`, extracted
// from the hook so it can be storied with plain props.
const meta = {
    title: "@agenta/entity-ui/DrillIn/RevertGroupButton",
    component: RevertGroupButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Section-scoped undo: restores every changed property in a group to its committed value, behind a confirm step composed on `Popover`.",
            },
        },
    },
} satisfies Meta<typeof RevertGroupButton>

export default meta
type Story = StoryObj<typeof meta>

/** Resting trigger — the group header's action. */
export const Default: Story = {
    args: {onConfirm: () => undefined},
    render: () => <RevertGroupButton onConfirm={() => undefined} />,
}

/** Nothing to revert / read-only surface. */
export const Disabled: Story = {
    args: {onConfirm: () => undefined, disabled: true},
    render: () => <RevertGroupButton onConfirm={() => undefined} disabled />,
}

/** The confirm panel, opened by clicking the trigger (interactive check). */
export const Confirming: Story = {
    args: {onConfirm: () => undefined},
    render: function Render() {
        const [reverted, setReverted] = useState(0)
        return (
            <div className="flex flex-col items-start gap-2">
                <RevertGroupButton onConfirm={() => setReverted((n) => n + 1)} />
                <span className="text-[11px] text-colorTextSecondary">
                    confirmed {reverted} time(s)
                </span>
            </div>
        )
    },
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

/** Closed trigger. */
export const Variants: Story = {
    args: {onConfirm: () => undefined},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="trigger">
                <RevertGroupButton onConfirm={() => undefined} />
            </Row>
            <Row label="trigger (disabled)">
                <RevertGroupButton onConfirm={() => undefined} disabled />
            </Row>
        </div>
    ),
}

/** Forced-OPEN confirm panel, rendered INLINE. */
function Panel({render}: {render: (container: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        // Wide enough that the ~400px confirm panel fits inside the portal container.
        <div ref={setEl} className="relative flex min-h-[200px] w-[520px] justify-end">
            {el && render(el)}
        </div>
    )
}

export const OpenState: Story = {
    args: {onConfirm: () => undefined},
    render: () => (
        <div className="flex gap-16 p-4">
            <Panel
                render={(c) => <RevertGroupButton open container={c} onConfirm={() => undefined} />}
            />
        </div>
    ),
}
