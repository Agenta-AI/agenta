import React from "react"

import {TracesWithAnnotations} from "@/oss/services/observability/types"

export interface TraceTreeProps {
    activeTrace?: TracesWithAnnotations
    activeTraceId?: string
    selected: string
    setSelected: React.Dispatch<React.SetStateAction<string>>
}
