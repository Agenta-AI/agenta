import {useAtomValue} from "jotai"

import {turnStartAtomFamily} from "../state/turnClock"

/**
 * The latest observed startup label, or null when no turn is being narrated.
 */
export const useStartupPhase = (sessionId: string): string | null =>
    useAtomValue(turnStartAtomFamily(sessionId)) ?? null
