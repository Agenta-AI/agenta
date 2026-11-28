import React from "react"

import type {SpanVisibilityMode} from "@agenta/observability"

export interface TraceTreeSettingsState {
    latency: boolean
    cost: boolean
    tokens: boolean
    visibility?: SpanVisibilityMode
    /** One row per conversation turn, its spans under it. */
    groupTurns?: boolean
}

/**
 * The tree settings of a user who never changed them. Tokens are off so a row fits one line;
 * a saved `traceTreeSettings` value wins over these.
 */
export const TRACE_TREE_DEFAULT_SETTINGS: TraceTreeSettingsState = {
    latency: true,
    cost: true,
    tokens: false,
    visibility: "key",
    groupTurns: false,
}

export interface TraceTreeSettingsProps {
    settings: TraceTreeSettingsState
    setSettings: React.Dispatch<React.SetStateAction<TraceTreeSettingsState>>
    /** Render the span visibility section (key spans vs all spans). */
    showVisibility?: boolean
    /**
     * The turns of the open trace. With it the menu shows "Group turns", disabled under two
     * turns.
     */
    turnCount?: number
}
