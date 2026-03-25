import {memo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared"
import {Typography} from "antd"

interface CreatedByCellProps {
    createdById: string | null | undefined
}

/**
 * Cell that displays who created the queue using the shared UserAuthorLabel with avatar badge.
 */
const CreatedByCell = memo(function CreatedByCell({createdById}: CreatedByCellProps) {
    if (!createdById) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    return (
        <Typography.Text type="secondary" className="text-xs truncate block">
            <UserAuthorLabel userId={createdById} showPrefix={false} showAvatar />
        </Typography.Text>
    )
})

export default CreatedByCell
