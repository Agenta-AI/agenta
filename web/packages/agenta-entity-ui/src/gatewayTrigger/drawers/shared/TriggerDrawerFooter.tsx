import type {ReactNode} from "react"

import {Button, Divider, Switch} from "antd"

/**
 * Shared footer for the trigger config drawers (schedule + subscription): an Active
 * toggle on the left, and Cancel / [run slot] / Save on the right. The run affordance
 * differs per trigger kind (a preview popover for schedules, an event-source popover for
 * subscriptions), so it is passed in as a slot rather than baked in.
 */
export function TriggerDrawerFooter({
    enabled,
    onEnabledChange,
    onCancel,
    run,
    isMutating,
    canSave,
    submitLabel,
    onSubmit,
}: {
    enabled: boolean
    onEnabledChange: (value: boolean) => void
    onCancel: () => void
    /** Optional run-in-playground affordance (playground only). */
    run?: ReactNode
    isMutating?: boolean
    canSave: boolean
    submitLabel: string
    onSubmit: () => void
}) {
    return (
        <>
            <Divider className="!m-0" />
            <div className="flex shrink-0 items-center justify-between gap-2 px-6 py-3">
                <div className="flex items-center gap-2">
                    <Switch checked={enabled} onChange={onEnabledChange} />
                    <span className="text-xs text-[var(--ag-colorTextSecondary)]">Active</span>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={onCancel}>Cancel</Button>
                    {run}
                    <Button
                        type="primary"
                        loading={isMutating}
                        disabled={!canSave}
                        onClick={onSubmit}
                    >
                        {submitLabel}
                    </Button>
                </div>
            </div>
        </>
    )
}
