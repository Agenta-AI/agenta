import {useCallback, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {appStateSnapshotAtom, requestNavigationAtom} from "./atoms"
import type {AppStateSnapshot, NavigationCommand, NavigationMethod, QueryValue} from "./types"

interface NavigateOptions {
    shallow?: boolean
}

interface QueryNavigationOptions extends NavigateOptions {
    method?: NavigationMethod
    preserveHash?: boolean
}

const arraysEqual = (a?: string[] | null, b?: string[] | null) => {
    if (a === b) return true
    if (!a || !b) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

const toPatchValue = (value: QueryValue): string | string[] | undefined => {
    if (value === null || value === undefined) return undefined
    if (Array.isArray(value)) return value
    return String(value)
}

export const useAppState = (): AppStateSnapshot => useAtomValue(appStateSnapshotAtom)

export const useAppQuery = () => useAtomValue(appStateSnapshotAtom).query

export const useAppNavigation = () => {
    const setNavigation = useSetAtom(requestNavigationAtom)

    const queue = useCallback(
        (command: NavigationCommand | null) => {
            setNavigation(command)
        },
        [setNavigation],
    )

    const push = useCallback(
        (href: string, options?: NavigateOptions) => {
            queue({
                type: "href",
                href,
                method: "push",
                ...(options?.shallow !== undefined ? {shallow: options.shallow} : {}),
            })
        },
        [queue],
    )

    const replace = useCallback(
        (href: string, options?: NavigateOptions) => {
            queue({
                type: "href",
                href,
                method: "replace",
                ...(options?.shallow !== undefined ? {shallow: options.shallow} : {}),
            })
        },
        [queue],
    )

    const patchQuery = useCallback(
        (
            patch: Record<string, string | string[] | undefined>,
            options?: QueryNavigationOptions,
        ) => {
            queue({
                type: "patch-query",
                patch,
                ...(options?.method ? {method: options.method} : {}),
                ...(options?.shallow !== undefined ? {shallow: options.shallow} : {}),
                ...(options?.preserveHash ? {preserveHash: true} : {}),
            })
        },
        [queue],
    )

    const setQueryParam = useCallback(
        (key: string, value: QueryValue, options?: QueryNavigationOptions) => {
            patchQuery({[key]: toPatchValue(value)}, options)
        },
        [patchQuery],
    )

    const removeQueryParam = useCallback(
        (key: string, options?: QueryNavigationOptions) => {
            patchQuery({[key]: undefined}, options)
        },
        [patchQuery],
    )

    return useMemo(
        () => ({push, replace, patchQuery, setQueryParam, removeQueryParam, queue}),
        [push, replace, patchQuery, setQueryParam, removeQueryParam, queue],
    )
}

export const useQueryParamState = (
    key: string,
): readonly [
    QueryValue,
    (
        value: QueryValue | ((prev: QueryValue) => QueryValue),
        options?: QueryNavigationOptions,
    ) => void,
] => {
    const snapshot = useAtomValue(appStateSnapshotAtom)
    const setNavigation = useSetAtom(requestNavigationAtom)
    const currentValue = Object.prototype.hasOwnProperty.call(snapshot.query, key)
        ? (snapshot.query[key] as QueryValue)
        : undefined

    const setValue = useCallback(
        (
            value: QueryValue | ((prev: QueryValue) => QueryValue),
            options?: QueryNavigationOptions,
        ) => {
            const resolved = typeof value === "function" ? (value as any)(currentValue) : value

            if (Array.isArray(resolved) && Array.isArray(currentValue)) {
                if (arraysEqual(resolved, currentValue)) return
            } else if (!Array.isArray(resolved) && !Array.isArray(currentValue)) {
                if (resolved === currentValue) return
            }

            setNavigation({
                type: "patch-query",
                patch: {[key]: toPatchValue(resolved)},
                ...(options?.method ? {method: options.method} : {}),
                ...(options?.shallow !== undefined ? {shallow: options.shallow} : {}),
                ...(options?.preserveHash ? {preserveHash: true} : {}),
            })
        },
        [currentValue, key, setNavigation],
    )

    return useMemo(() => [currentValue, setValue] as const, [currentValue, setValue])
}
