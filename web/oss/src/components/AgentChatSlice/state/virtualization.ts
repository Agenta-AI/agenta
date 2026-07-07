import {atomWithStorage} from "jotai/utils"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

/**
 * SPIKE(virtuoso): live-tunable agent-chat virtualization knobs, surfaced in the playground settings
 * dropdown so we can experiment without code edits. All localStorage-persisted. Removed with the spike.
 */

/** Availability gate. Virtualization (settings section + windowing) is only offered when the
 * `NEXT_PUBLIC_AGENT_CHAT_VIRTUALIZATION` env flag is "true". Absent → the settings toggle is the only
 * remaining control and it never takes effect. */
export const isAgentChatVirtualizationAvailable = (): boolean =>
    (getEnv("NEXT_PUBLIC_AGENT_CHAT_VIRTUALIZATION") || "").toLowerCase() === "true"

/** Master switch: on → Virtuoso windows the settled history; off → content-visibility path. */
export const agentChatVirtualizeAtom = atomWithStorage<boolean>(
    "agenta:agent-chat-virtualize",
    false,
)

/** Render buffer above the viewport (px). Wider = rows measure before entering view (fewer blanks /
 * less jitter) at the cost of more mounted rows. The bottom buffer is derived as ~2/3 of this. */
export const AGENT_CHAT_OVERSCAN_OPTIONS: {label: string; value: number}[] = [
    {label: "Tight (1200)", value: 1200},
    {label: "Wide (3000)", value: 3000},
    {label: "Huge (6000)", value: 6000},
]
export const agentChatOverscanAtom = atomWithStorage<number>("agenta:agent-chat-overscan", 3000)

/** Estimated row height (px) for not-yet-measured rows. Closer to real → smaller correction. */
export const AGENT_CHAT_ITEM_ESTIMATE_OPTIONS: {label: string; value: number}[] = [
    {label: "Short (120)", value: 120},
    {label: "Medium (240)", value: 240},
    {label: "Tall (480)", value: 480},
]
export const agentChatItemEstimateAtom = atomWithStorage<number>(
    "agenta:agent-chat-item-estimate",
    240,
)
