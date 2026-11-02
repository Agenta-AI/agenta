import React from "react"

import type {SpanVisibilityMode} from "@agenta/observability"

export interface TraceTreeSettingsState {
    latency: boolean
    cost: boolean
    tokens: boolean
    visibility?: SpanVisibilityMode
}

export interface TraceTreeSettingsProps {
    settings: TraceTreeSettingsState
    setSettings: React.Dispatch<React.SetStateAction<TraceTreeSettingsState>>
    /** Render the span visibility section (key spans vs all spans). */
    showVisibility?: boolean
}
