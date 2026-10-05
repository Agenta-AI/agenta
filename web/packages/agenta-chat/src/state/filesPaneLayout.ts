import {useCallback, useEffect, useState} from "react"

import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"

import {playgroundLayoutActionAtom} from "./panelLayout"

interface FilesLayout {
    sessionId: string
    action: number
    expanded: boolean
    configCollapsed: boolean
}

const filesLayoutAtomFamily = atomFamily((_host: string) => atom<FilesLayout | null>(null))

/** One transient layout per host. Width and visibility preferences are never written here. */
export function useFilesPaneLayout(host: string, sessionId: string, open: boolean) {
    const [layout, setLayout] = useAtom(filesLayoutAtomFamily(host))
    const action = useAtomValue(playgroundLayoutActionAtom)
    const retained = open && layout?.sessionId === sessionId && layout.action === action
    const expanded = Boolean(retained && layout?.expanded)
    useEffect(() => {
        if (!retained && layout) setLayout(null)
    }, [retained, layout, setLayout])
    const toggleExpand = useCallback(
        (configCollapsed: boolean) => {
            if (!open || !sessionId) return
            setLayout((previous) =>
                previous?.sessionId === sessionId && previous.action === action
                    ? {...previous, expanded: !previous.expanded}
                    : {sessionId, action, expanded: true, configCollapsed},
            )
        },
        [open, sessionId, action, setLayout],
    )
    return {
        expanded,
        retaining: Boolean(retained),
        configCollapsed: retained ? layout.configCollapsed : undefined,
        toggleExpand,
    }
}

/** Measure the workspace itself, including changes to the surrounding navigation width. */
export function usePaneContainerWidth() {
    const [element, setElement] = useState<HTMLDivElement | null>(null)
    const [width, setWidth] = useState<number | null>(null)
    useEffect(() => {
        if (!element) return
        const read = () => setWidth(element.getBoundingClientRect().width)
        read()
        if (typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(read)
        observer.observe(element)
        return () => observer.disconnect()
    }, [element])
    return {containerRef: setElement, containerWidth: width}
}
