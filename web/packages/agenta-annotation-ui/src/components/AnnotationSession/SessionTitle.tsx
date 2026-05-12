import {memo} from "react"

import type {SessionTitleProps} from "./assets/type"

const SessionTitle = memo(function SessionTitle({queueName}: SessionTitleProps) {
    return <span className="truncate">{queueName}</span>
})

export default SessionTitle
