import type {ReactNode} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Divider, Switch} from "antd"

/**
 * Shared footer for entity config drawers (triggers: schedule + subscription; tools: integration
 * + reference). Cancel / [run slot] / Save on the right; the left side is an Active toggle when
 * `onEnabledChange` is supplied (triggers), otherwise an optional `left` slot or empty (tools).
 * The run affordance differs per surface, so it is passed in as a slot rather than baked in.
 */
export function DrawerFooter({
    enabled,
    onEnabledChange,
    left,
    onCancel,
    run,
    isMutating,
    canSave,
    submitLabel,
    onSubmit,
}: {
    /** When `onEnabledChange` is provided, render an Active toggle on the left. */
    enabled?: boolean
    onEnabledChange?: (value: boolean) => void
    /** Left-side content when there's no Active toggle. */
    left?: ReactNode
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
                    {onEnabledChange ? (
                        <>
                            <Switch checked={enabled} onChange={onEnabledChange} />
                            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                                Active
                            </span>
                        </>
                    ) : (
                        left
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={onCancel} variant="outline">
                        Cancel
                    </Button>
                    {run}
                    <Button disabled={!canSave || isMutating} onClick={onSubmit}>
                        {isMutating ? <Spinner /> : null}
                        {submitLabel}
                    </Button>
                </div>
            </div>
        </>
    )
}
