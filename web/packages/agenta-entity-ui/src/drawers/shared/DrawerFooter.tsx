import {type ReactNode} from "react"

import {Button, Divider, LoadingButton} from "@agenta/ui/ui"

/**
 * Shared footer for entity config drawers (triggers: schedule + subscription; tools: integration
 * + reference). Cancel / Save on the right, an optional `left` slot on the left.
 */
export function DrawerFooter({
    left,
    onCancel,
    isMutating,
    canSave,
    submitLabel,
    onSubmit,
    cancelVariant = "outline",
}: {
    left?: ReactNode
    onCancel: () => void
    isMutating?: boolean
    canSave: boolean
    submitLabel: string
    onSubmit: () => void
    /** `ghost` draws Cancel as text, for footers where only the primary action carries a box. */
    cancelVariant?: "outline" | "ghost"
}) {
    return (
        <>
            <Divider className="m-0" />
            <div className="flex shrink-0 items-center justify-between gap-2 px-6 py-3">
                <div className="flex items-center gap-2">{left}</div>
                <div className="flex items-center gap-2">
                    <Button variant={cancelVariant} onClick={onCancel}>
                        Cancel
                    </Button>
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
