import {useEffect, useState} from "react"

import {STAGE_WORD_MS, stageWordAt, type StageWords} from "../assets/startupPhases"

/** Counted from `since` when known, so a remount mid-stage does not restart the words. */
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
