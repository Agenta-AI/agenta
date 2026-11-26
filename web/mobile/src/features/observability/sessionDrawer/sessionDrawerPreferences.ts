import type {TraceTreeSettingsState} from "@agenta/observability-ui/traceDrawer"
import {atomWithStorage} from "jotai/utils"

/** Same key /w uses, so a choice made there carries over. */
export const observabilitySessionAnnotationsVisibleAtom = atomWithStorage(
    "chat-session-annotation-ui",
    true,
)

/** Shared with the trace drawer: one choice of what a tree row shows. */
export const observabilitySessionTreeSettingsAtom = atomWithStorage<TraceTreeSettingsState>(
    "traceTreeSettings",
    {latency: true, cost: true, tokens: true},
)
