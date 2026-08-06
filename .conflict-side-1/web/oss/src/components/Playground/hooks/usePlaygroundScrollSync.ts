import {useEffect, useRef, useState} from "react"

import useAnimationFrame from "use-animation-frame"

interface ScrollSyncOptions {
    enabled: boolean
}

interface ScrollTargets {
    scrolling: HTMLElement
    target: HTMLElement
}

export const usePlaygroundScrollSync = ({enabled}: ScrollSyncOptions) => {
    const [configPanelRef, setConfigPanelRef] = useState<HTMLElement | null>(null)
    const [generationPanelRef, setGenerationPanelRef] = useState<HTMLElement | null>(null)
    const scrollingRef = useRef<ScrollTargets | null>(null)

    useAnimationFrame(() => {
        if (!enabled) return
        if (!scrollingRef.current) return

        const {scrolling, target} = scrollingRef.current
        if (!scrolling || !target) return

        target.scrollLeft = scrolling.scrollLeft
    })

    useEffect(() => {
        if (!enabled) {
            scrollingRef.current = null
            return
        }

        const configPanel = configPanelRef
        const generationPanel = generationPanelRef

        if (!configPanel && !generationPanel) {
            return
        }

        const handleScroll = (event: Event) => {
            if (!enabled) return
            if (scrollingRef.current) return

            const source = event.target as HTMLElement | null
            if (!source) return

            const scrolling = source.isSameNode(configPanel) ? configPanel : generationPanel
            if (!scrolling) return

            const target = scrolling.isSameNode(configPanel) ? generationPanel : configPanel
            if (!target) return

            scrollingRef.current = {scrolling, target}
        }

        const handleScrollEnd = () => {
            scrollingRef.current = null
        }

        configPanel?.addEventListener("scroll", handleScroll)
        configPanel?.addEventListener("scrollend", handleScrollEnd)
        generationPanel?.addEventListener("scroll", handleScroll)
        generationPanel?.addEventListener("scrollend", handleScrollEnd)

        return () => {
            configPanel?.removeEventListener("scroll", handleScroll)
            configPanel?.removeEventListener("scrollend", handleScrollEnd)
            generationPanel?.removeEventListener("scroll", handleScroll)
            generationPanel?.removeEventListener("scrollend", handleScrollEnd)
            scrollingRef.current = null
        }
    }, [enabled, configPanelRef, generationPanelRef])

    return {
        configPanelRef,
        generationPanelRef,
        setConfigPanelRef,
        setGenerationPanelRef,
    }
}

export default usePlaygroundScrollSync
