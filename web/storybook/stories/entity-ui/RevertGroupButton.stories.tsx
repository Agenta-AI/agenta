import {useState} from "react"

import {ArrowCounterClockwise} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Popconfirm as AntPopconfirm} from "antd"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {RevertGroupButton} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/RevertGroupButton"

// RevertGroupButton — the section-scoped "Revert" header action from `useModelHarness`, extracted
// from the hook so it can be storied with plain props. Migration: antd `Popconfirm` + `Button
// type="text" icon` → a confirm step COMPOSED on the `@agenta/ui` `Popover` (there is no
// Popconfirm primitive) + `Button variant="ghost"` with the icon as a child.
//
// The antd half replays the pre-migration markup from
// `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx`
// (`revertAction`).
const meta = {
    title: "@agenta/entity-ui/DrillIn/RevertGroupButton",
    component: RevertGroupButton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Section-scoped undo: restores every changed property in a group to its committed value, behind a confirm step. antd `Popconfirm` has no `@agenta/ui` counterpart — the panel is composed on `Popover` with antd's Popconfirm geometry (12px padding, warning icon, bold title, 4px description offset, right-aligned small Cancel/OK).",
            },
        },
    },
} satisfies Meta<typeof RevertGroupButton>

export default meta
type Story = StoryObj<typeof meta>

const TITLE = "Revert this group?"
const DESCRIPTION = "Every unsaved change in it goes back to the committed value."

/** Pre-migration antd markup (closed trigger). */
const AntdRevertAction = ({disabled}: {disabled?: boolean}) => (
    <AntPopconfirm
        title={TITLE}
        description={DESCRIPTION}
        okText="Revert"
        cancelText="Cancel"
        placement="bottomRight"
        onConfirm={() => undefined}
    >
        <AntButton
            type="text"
            icon={<ArrowCounterClockwise size={13} />}
            onClick={(e) => e.stopPropagation()}
            disabled={disabled}
            className="!h-auto !px-1 !py-0.5 !text-[11px] !text-[var(--ag-colorTextSecondary)]"
        >
            Revert
        </AntButton>
    </AntPopconfirm>
)

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

// ---------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[10rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex items-center">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex items-center">
                {s}
            </div>
        </div>
    </div>
)

/** Closed trigger: antd `Button type="text" icon` vs `Button variant="ghost"` + icon child. */
export const AntdVsAgenta: Story = {
    args: {onConfirm: () => undefined},
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="trigger"
                expected="ACCEPTED DEVIATION (GOTCHAS.md): antd wraps a button icon in `.ant-btn-icon`, whose 15.5px inline text box makes the button 20.63px tall and lands the glyph 0.81px high; we centre the bare svg, i.e. correctly. Width (64.42px), padding, radius, gap and colour are identical — the residue is the icon row only (287 absolute px)."
                a={<AntdRevertAction />}
                s={<RevertGroupButton onConfirm={() => undefined} />}
            />
            <Row
                label="trigger (disabled)"
                expected="same accepted icon-box deviation as the row above"
                a={<AntdRevertAction disabled />}
                s={<RevertGroupButton onConfirm={() => undefined} disabled />}
            />
        </div>
    ),
}

/** Forced-OPEN confirm panel, rendered INLINE so the two overlays sit side by side. */
function Panel({render}: {render: (container: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        // Wide enough that the ~400px confirm panel fits inside the portal container: a
        // narrower box makes both libraries' collision logic shift the panel, and the crop
        // then compares two differently-nudged panels instead of two panels.
        <div ref={setEl} className="relative flex min-h-[200px] w-[520px] justify-end">
            {el && render(el)}
        </div>
    )
}

export const OpenState: Story = {
    args: {onConfirm: () => undefined},
    render: () => (
        <div
            className="flex gap-16 p-4"
            data-open-compare
            data-vrt-expected="no arrow: @agenta/ui `PopoverContent` exposes no Radix `Arrow` slot (Tooltip's is baked in), so antd's Popconfirm caret is not reproduced. Panel padding/typography/buttons match."
        >
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntPopconfirm
                            open
                            getPopupContainer={() => c}
                            title={TITLE}
                            description={DESCRIPTION}
                            okText="Revert"
                            cancelText="Cancel"
                            placement="bottomRight"
                        >
                            <AntButton
                                type="text"
                                icon={<ArrowCounterClockwise size={13} />}
                                className="!h-auto !px-1 !py-0.5 !text-[11px] !text-[var(--ag-colorTextSecondary)]"
                            >
                                Revert
                            </AntButton>
                        </AntPopconfirm>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <RevertGroupButton open container={c} onConfirm={() => undefined} />
                    )}
                />
            </div>
        </div>
    ),
}
