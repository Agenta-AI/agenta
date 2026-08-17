import {useEffect, useReducer} from "react"

import {useAtomValue} from "jotai"

import {msUntilNextStartupPhase, startupPhaseAt} from "../assets/startupPhases"
import {turnStartAtomFamily} from "../state/turnClock"

/**
 * The current startup label for a session's in-flight turn, or null when there is nothing to say
 * (#6047) — no turn being narrated, or one still inside the grace window.
 *
 * The label is DERIVED on every render rather than stored, so it can never lag the clock: the same
 * shape `MessageTimestamp` uses for `timeAgo`. The effect exists only to force a render at each
 * phase boundary, and it sleeps exactly that long — no polling, and it stops scheduling once the
 * last phase lands, so a turn that then runs for minutes costs no timers at all.
 */
export const useStartupPhase = (sessionId: string): string | null => {
    const startedAt = useAtomValue(turnStartAtomFamily(sessionId))
    const [, advancePhase] = useReducer((n: number) => n + 1, 0)

    useEffect(() => {
        if (startedAt === undefined) return
        let timer: ReturnType<typeof setTimeout> | undefined
        const scheduleNext = () => {
            // Re-read the real clock each hop: a backgrounded tab fires late, and this then skips
            // the boundaries it slept through instead of walking the ladder at the wrong speed.
            const delay = msUntilNextStartupPhase(Date.now() - startedAt)
            if (delay === undefined) return
            timer = setTimeout(() => {
                advancePhase()
                scheduleNext()
            }, delay)
        }
        scheduleNext()
        return () => clearTimeout(timer)
    }, [startedAt])

    return startedAt === undefined ? null : startupPhaseAt(Date.now() - startedAt)
}
