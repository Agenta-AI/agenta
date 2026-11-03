import type {ReactNode} from "react"

import {Button} from "@agenta/ui/ui"
import {TrashIcon} from "@phosphor-icons/react"

/** One pick shown under its picker: a label and a remove button. */
export const PickedCard = ({
    children,
    removeLabel,
    disabled,
    onRemove,
}: {
    children: ReactNode
    removeLabel: string
    disabled?: boolean
    onRemove: () => void
}) => (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2.5">
        <div className="min-w-0 flex-1 truncate text-sm">{children}</div>
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={removeLabel}
            disabled={disabled}
            onClick={onRemove}
        >
            <TrashIcon />
        </Button>
    </div>
)
