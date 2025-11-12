import React from "react"

import {TracesWithAnnotations} from "@/oss/services/observability/types"

export interface TraceTreeProps {
    activeTrace?: TracesWithAnnotations
    activeTraceId?: string
    selected: string | null
    setSelected: (key: string) => void
    enableTour?: boolean
}
