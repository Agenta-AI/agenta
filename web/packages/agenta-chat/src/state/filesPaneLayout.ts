import {useCallback, useEffect} from "react"

import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"

import {playgroundLayoutActionAtom} from "./panelLayout"

interface FilesLayout {
    sessionId: string
    action: number
    expanded: boolean
}

const filesLayoutAtomFamily = atomFamily((_host: string) => atom<FilesLayout | null>(null))

/**
 * Transient files-pane expansion, one record per host. Any explicit layout action (a collapse or
 * maximize write), a session switch, or closing the pane ends it, so the width and visibility
 * preferences never need to be written or restored here.
 */
export function useFilesPaneLayout(host: string, sessionId: string, open: boolean) {
    const [layout, setLayout] = useAtom(filesLayoutAtomFamily(host))
    const action = useAtomValue(playgroundLayoutActionAtom)
    const current = open && layout?.sessionId === sessionId && layout.action === action
    const expanded = Boolean(current && layout?.expanded)
    useEffect(() => {
        if (!current && layout) setLayout(null)
    }, [current, layout, setLayout])
    const toggleExpand = useCallback(() => {
        if (!open || !sessionId) return
        setLayout(expanded ? null : {sessionId, action, expanded: true})
    }, [open, sessionId, action, expanded, setLayout])
    return {expanded, toggleExpand}
}
