import {useId, type ReactNode} from "react"

import {Button, Divider, LoadingButton, Switch} from "@agenta/ui/ui"

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
    // Names the Switch from the adjacent visible "Active" text (axe button-name).
    const activeLabelId = useId()
    return (
        <>
            <Divider className="m-0" />
            <div className="flex shrink-0 items-center justify-between gap-2 px-6 py-3">
                <div className="flex items-center gap-2">
                    {onEnabledChange ? (
                        <>
                            <Switch
                                checked={enabled}
                                onCheckedChange={onEnabledChange}
                                aria-labelledby={activeLabelId}
                            />
                            <span
                                id={activeLabelId}
                                className="text-xs text-[var(--ag-colorTextSecondary)]"
                            >
                                Active
                            </span>
                        </>
                    ) : (
                        left
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    {run}
                    <LoadingButton
                        variant="default"
                        loading={isMutating}
                        disabled={!canSave}
                        onClick={onSubmit}
                        // antd dims a loading button to opacityLoading (0.65); LoadingButton doesn't.
                    >
                        {submitLabel}
                    </LoadingButton>
                </div>
            </div>
        </>
    )
}
