import {memo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared"

interface CreatedByCellProps {
    createdById: string | null | undefined
}

/**
 * Cell that displays who created the queue using the shared UserAuthorLabel with avatar badge.
 */
const CreatedByCell = memo(function CreatedByCell({createdById}: CreatedByCellProps) {
    if (!createdById) {
        return <span className="text-muted-foreground">—</span>
    }

    return (
        <span className="text-xs truncate block text-muted-foreground">
            <UserAuthorLabel userId={createdById} showPrefix={false} showAvatar />
        </span>
    )
})

export default CreatedByCell
