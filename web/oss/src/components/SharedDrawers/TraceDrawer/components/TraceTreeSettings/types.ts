import React from "react"

import {SpanVisibilityMode} from "../TraceTree/assets/spanVisibility"

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
