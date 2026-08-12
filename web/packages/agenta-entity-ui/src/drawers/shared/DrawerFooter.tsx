import {type ReactNode} from "react"

import {Button, Divider, LoadingButton} from "@agenta/ui/ui"

/**
 * Shared footer for entity config drawers (triggers: schedule + subscription; tools: integration
 * + reference). Cancel / [run slot] / Save on the right, an optional `left` slot on the left.
 * The run affordance differs per surface, so it is passed in as a slot rather than baked in.
 */
export function DrawerFooter({
    left,
    onCancel,
    run,
    isMutating,
    canSave,
    submitLabel,
    onSubmit,
}: {
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
            <Divider className="m-0" />
            <div className="flex shrink-0 items-center justify-between gap-2 px-6 py-3">
                <div className="flex items-center gap-2">{left}</div>
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
