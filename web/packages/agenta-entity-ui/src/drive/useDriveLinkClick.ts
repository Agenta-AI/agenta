/**
 * A click on a link inside a rendered drive file: a path opens that file in the pane; a web URL is
 * left to whatever renders the anchor (a new tab). The decision is the href's shape
 * ({@link resolveDriveLink}), disambiguated against the tree already in memory — never a fetch.
 */
import {type MouseEvent as ReactMouseEvent, useCallback} from "react"

import {resolveDriveLink} from "@agenta/entities/drive"

/** A click asking for a new tab on purpose, or not a plain left click: the browser keeps it. */
const isPlainClick = (e: {
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
    button: number
}) => !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0

/** For a renderer that reports the link's URL AS WRITTEN (the Lexical editor): true when taken. */
export function useDriveLinkClick(
    fromPath: string,
    onNavigate?: (path: string) => void,
    exists?: (path: string) => boolean,
): (url: string, event: MouseEvent) => boolean {
    return useCallback(
        (url: string, event: MouseEvent) => {
            if (!onNavigate || !isPlainClick(event)) return false
            const target = resolveDriveLink(url, fromPath, exists)
            if (!target) return false
            onNavigate(target)
            return true
        },
        [fromPath, onNavigate, exists],
    )
}

/** For plain rendered HTML: a capture-phase click handler that reads the nearest anchor's href,
 * so it decides before the anchor's own `target` does. */
export function useDriveAnchorClickCapture(
    fromPath: string,
    onNavigate?: (path: string) => void,
    exists?: (path: string) => boolean,
): (e: ReactMouseEvent<HTMLElement>) => void {
    return useCallback(
        (e: ReactMouseEvent<HTMLElement>) => {
            if (!onNavigate || !isPlainClick(e)) return
            const anchor = (e.target as Element | null)?.closest?.("a[href]")
            const target = anchor
                ? resolveDriveLink(anchor.getAttribute("href"), fromPath, exists)
                : null
            if (!target) return
            e.preventDefault()
            e.stopPropagation()
            onNavigate(target)
        },
        [fromPath, onNavigate, exists],
    )
}
