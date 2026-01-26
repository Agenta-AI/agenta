import {getDefaultStore} from "jotai"
import type {Store} from "jotai/vanilla/store"
import Router from "next/router"

import {
    selectedVariantsAtom,
    viewTypeAtom,
    urlRevisionsAtom,
} from "@/oss/components/Playground/state/atoms"
import {appStateSnapshotAtom} from "@/oss/state/appState"
import {revisionListAtom} from "@/oss/state/variant/selectors/variant"

const isBrowser = typeof window !== "undefined"
const PLAYGROUND_PARAM = "playgroundRevisions"

const sanitizeRevisionList = (values: (string | null | undefined)[]) => {
    const seen = new Set<string>()
    const result: string[] = []
    values.forEach((value) => {
        if (value === null || value === undefined) return
        const str = String(value).trim()
        if (!str || str === "null" || str === "undefined") return
        if (seen.has(str)) return
        seen.add(str)
        result.push(str)
    })
    return result
}

const parseRevisionParam = (raw: string | null | undefined): string[] => {
    if (!raw) return []
    const trimmed = raw.trim()
    if (!trimmed) return []

    const tryParse = (value: string): string[] => {
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
                return sanitizeRevisionList(
                    parsed.map((item) => (item === null || item === undefined ? "" : String(item))),
                )
            }
        } catch {
            // ignore
        }
        return []
    }

    const direct = tryParse(trimmed)
    if (direct.length > 0) return direct

    try {
        const decoded = tryParse(decodeURIComponent(trimmed))
        if (decoded.length > 0) return decoded
    } catch {
        // ignore decode failures
    }

    if (trimmed.includes(",")) {
        return sanitizeRevisionList(trimmed.split(","))
    }

    return sanitizeRevisionList([trimmed])
}

const arraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

const serializeSelection = (selection: string[]) =>
    selection.length > 0 ? JSON.stringify(selection) : null

export const writePlaygroundSelectionToQuery = async (selection: string[]) => {
    if (!isBrowser) return

    try {
        const sanitized = sanitizeRevisionList(selection)
        const url = new URL(window.location.href)
        const serialized = serializeSelection(sanitized)
        const current = url.searchParams.get(PLAYGROUND_PARAM)

        if (serialized) {
            if (current === serialized) return
            url.searchParams.set(PLAYGROUND_PARAM, serialized)
        } else if (current === null) {
            return
        } else {
            url.searchParams.delete(PLAYGROUND_PARAM)
        }

        const newPath = `${url.pathname}${url.search}${url.hash}`
        await Router.replace(newPath, undefined, {shallow: true})
    } catch (error) {
        console.error("Failed to write playground revisions to query:", error)
    }
}

const applyPlaygroundSelection = (store: Store, next: string[]) => {
    const sanitized = sanitizeRevisionList(next)
    const currentSelected = sanitizeRevisionList(store.get(selectedVariantsAtom))
    if (!arraysEqual(currentSelected, sanitized)) {
        store.set(selectedVariantsAtom, sanitized)
    }

    const currentUrlSelection = sanitizeRevisionList(store.get(urlRevisionsAtom))
    if (!arraysEqual(currentUrlSelection, sanitized)) {
        store.set(urlRevisionsAtom, sanitized)
    }

    const nextViewType = sanitized.length > 1 ? "comparison" : "single"
    if (store.get(viewTypeAtom) !== nextViewType) {
        store.set(viewTypeAtom, nextViewType)
    }
}

let lastPlaygroundAppId: string | null = null

export const ensurePlaygroundDefaults = (store: Store) => {
    if (!isBrowser) return

    const appState = store.get(appStateSnapshotAtom)
    if (
        !appState.pathname?.includes("/playground") ||
        appState.pathname?.includes("/playground-test")
    )
        return

    const selected = sanitizeRevisionList(store.get(selectedVariantsAtom))
    const urlSelection = sanitizeRevisionList(store.get(urlRevisionsAtom))
    if (selected.length > 0 || urlSelection.length > 0) return

    const revisions = store.get(revisionListAtom) as {id?: string}[] | undefined
    if (!Array.isArray(revisions) || revisions.length === 0) return

    const latestRevisionId = revisions[0]?.id
    if (!latestRevisionId) return

    applyPlaygroundSelection(store, [latestRevisionId])
}

export const syncPlaygroundStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const isPlaygroundRoute =
            url.pathname.includes("/playground") && !url.pathname.includes("/playground-test")
        const appState = store.get(appStateSnapshotAtom)
        const currentAppId = appState.appId ?? null

        const paramSelection = parseRevisionParam(url.searchParams.get(PLAYGROUND_PARAM))
        const currentSelected = sanitizeRevisionList(store.get(selectedVariantsAtom))
        const currentUrlSelection = sanitizeRevisionList(store.get(urlRevisionsAtom))

        if (isPlaygroundRoute) {
            if (
                lastPlaygroundAppId &&
                currentAppId &&
                lastPlaygroundAppId !== currentAppId &&
                paramSelection.length === 0
            ) {
                if (currentSelected.length > 0) {
                    store.set(selectedVariantsAtom, [])
                }
                if (currentUrlSelection.length > 0) {
                    store.set(urlRevisionsAtom, [])
                }
            }
            lastPlaygroundAppId = currentAppId
        } else {
            lastPlaygroundAppId = null
        }

        let targetSelection: string[] = []
        // Apply precedence: explicit query param > pending urlRevisions state > persisted selection
        if (paramSelection.length > 0) {
            targetSelection = paramSelection
        } else if (currentUrlSelection.length > 0) {
            targetSelection = currentUrlSelection
        } else if (currentSelected.length > 0) {
            targetSelection = currentSelected
        }

        if (isPlaygroundRoute) {
            if (targetSelection.length > 0) {
                applyPlaygroundSelection(store, targetSelection)
            }

            ensurePlaygroundDefaults(store)
        } else {
            if (currentUrlSelection.length > 0) {
                store.set(urlRevisionsAtom, [])
            }
        }
    } catch (err) {
        console.error("Failed to sync playground state from URL:", nextUrl, err)
    }
}
