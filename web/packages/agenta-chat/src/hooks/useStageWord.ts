import {useEffect, useState} from "react"

import {STAGE_WORD_MS, stageWordAt, type StageWords} from "../assets/startupPhases"

/**
 * The word to show now: the lead words in order, then the loop. Counted from `since` (when the
 * stage began) when known, so a remount mid-stage picks up where the line was instead of
 * starting the stage over; otherwise from when the line became active.
 */
export const useStageWord = (words: StageWords, active: boolean, since: number | null): string => {
    const [activeSince, setActiveSince] = useState<number | null>(null)
    const [, setNow] = useState(0)
    useEffect(() => {
        if (!active) {
            setActiveSince(null)
            return
        }
        setActiveSince((current) => current ?? Date.now())
        const id = setInterval(() => setNow(Date.now()), STAGE_WORD_MS / 4)
        return () => clearInterval(id)
    }, [active])
    const start = since ?? activeSince
    const tick = active && start !== null ? Math.floor((Date.now() - start) / STAGE_WORD_MS) : 0
    return stageWordAt(words, Math.max(0, tick))
}
