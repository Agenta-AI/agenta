import {getDefaultStore} from "jotai"
import Router from "next/router"

import {compareRunIdsAtom} from "../atoms/compare"

const COMPARE_QUERY_KEY = "compare"

const parseCompareParam = (value: string | string[] | undefined): string[] => {
    if (!value) return []
    if (Array.isArray(value)) {
        return value
            .flatMap((entry) => String(entry).split(","))
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
    }
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
}

export const syncCompareStateFromUrl = (nextUrl?: string) => {
    if (typeof window === "undefined") return
    try {
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const values = url.searchParams.getAll(COMPARE_QUERY_KEY)
        const compareIds = parseCompareParam(
            values.length ? values : (url.searchParams.get(COMPARE_QUERY_KEY) ?? undefined),
        )

        const store = getDefaultStore()
        store.set(compareRunIdsAtom, compareIds)
    } catch (error) {
        console.error("Failed to sync comparison state from URL", error)
    }
}

export const setCompareQueryParams = (compareIds: string[]) => {
    if (typeof window === "undefined") return
    try {
        const url = new URL(window.location.href)
        url.searchParams.delete(COMPARE_QUERY_KEY)
        if (compareIds.length) {
            url.searchParams.set(COMPARE_QUERY_KEY, compareIds.join(","))
        }
        const newPath = `${url.pathname}${url.search}${url.hash}`
        void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
            console.error("Failed to update comparison query params", error)
        })
    } catch (error) {
        console.error("Failed to update comparison query params", error)
    }
}

export const clearCompareState = () => {
    const store = getDefaultStore()
    store.set(compareRunIdsAtom, [])
    setCompareQueryParams([])
}

export default {
    syncCompareStateFromUrl,
    setCompareQueryParams,
    clearCompareState,
}
