import {useEffect, useState} from "react"

/** How long after its last scroll event an area stops leading. */
const SETTLE_MS = 100

/**
 * Keeps the sideways scroll of the compare view's config area and run area in step: the area the
 * user scrolls leads, the other one follows. The scroll the follower gets fires its own scroll
 * event; while the leader is still scrolling that event is ignored, so the two never fight.
 *
 * Returns ref setters for the two areas.
 */
export const usePlaygroundScrollSync = ({enabled}: {enabled: boolean}) => {
    const [configPanel, setConfigPanelRef] = useState<HTMLElement | null>(null)
    const [generationPanel, setGenerationPanelRef] = useState<HTMLElement | null>(null)

    useEffect(() => {
        if (!enabled || !configPanel || !generationPanel) return
        let leader: HTMLElement | null = null
        let timer: ReturnType<typeof setTimeout> | undefined
        const release = () => {
            leader = null
        }
        const follow = (source: HTMLElement, target: HTMLElement) => () => {
            if (leader && leader !== source) return
            leader = source
            if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft
            clearTimeout(timer)
            timer = setTimeout(release, SETTLE_MS)
        }
        const fromConfig = follow(configPanel, generationPanel)
        const fromRuns = follow(generationPanel, configPanel)
        configPanel.addEventListener("scroll", fromConfig, {passive: true})
        generationPanel.addEventListener("scroll", fromRuns, {passive: true})
        return () => {
            clearTimeout(timer)
            configPanel.removeEventListener("scroll", fromConfig)
            generationPanel.removeEventListener("scroll", fromRuns)
        }
    }, [enabled, configPanel, generationPanel])

    return {setConfigPanelRef, setGenerationPanelRef}
}
