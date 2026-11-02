import React from "react"

import type {TracesWithAnnotations} from "@agenta/observability/dto"

export interface TraceTreeProps {
    activeTrace?: TracesWithAnnotations
    activeTraceId?: string
    selected: string
    setSelected: React.Dispatch<React.SetStateAction<string>>
}
