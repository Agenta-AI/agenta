import React from "react"

import {TracesWithAnnotations} from "@agenta/observability/dto"

export interface SessionTreeProps {
    activeTrace?: TracesWithAnnotations
    activeTraceId?: string
    selected: string
    setSelected: React.Dispatch<React.SetStateAction<string>>
}
