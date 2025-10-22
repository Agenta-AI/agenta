import {useCallback, useEffect, useRef} from "react"

import {ParsedUrlQuery} from "querystring"

import {useAppNavigation, useAppQuery} from "@/oss/state/appState"

type Method = "push" | "replace"

const normalizeValue = (
    value: string | string[] | number | boolean | null | undefined,
): string | string[] | undefined => {
    if (value === null || value === undefined) return undefined
    if (Array.isArray(value)) {
        const normalizedArray = value
            .map((item) => {
                if (item === null || item === undefined) return undefined
                const str = String(item)
                return str === "" ? undefined : str
            })
            .filter((item): item is string => item !== undefined)

        return normalizedArray.length > 0 ? normalizedArray : undefined
    }

    const normalized = String(value)
    return normalized === "" ? undefined : normalized
}

const valuesAreEqual = (
    current: string | string[] | undefined,
    next: string | string[] | undefined,
) => {
    if (current === next) return true
    if (Array.isArray(current) && Array.isArray(next)) {
        if (current.length !== next.length) return false
        return current.every((value, index) => value === next[index])
    }
    return !Array.isArray(current) && !Array.isArray(next) && current === next
}

export function useQuery(
    method: Method = "push",
): [ParsedUrlQuery, (query: ParsedUrlQuery) => void] {
    const query = useAppQuery()
    const navigation = useAppNavigation()
    const queryRef = useRef(query)

    useEffect(() => {
        queryRef.current = query
    }, [query])

    const updateQuery = useCallback(
        (queryObj: ParsedUrlQuery) => {
            const nextQuery: Record<string, string | string[] | undefined> = {}
            let hasChanged = false
            const currentQuery = queryRef.current

            Object.keys(queryObj).forEach((key) => {
                const requestedValue = normalizeValue(queryObj[key] as any)
                const currentValue = normalizeValue(currentQuery[key] as any)

                if (!valuesAreEqual(currentValue, requestedValue)) {
                    hasChanged = true
                }

                nextQuery[key] = requestedValue
            })

            if (!hasChanged) return

            navigation.patchQuery(nextQuery, {method, shallow: true})
        },
        [method, navigation],
    )

    return [query, updateQuery]
}

export function useQueryParam(
    paramName: string,
    defaultValue?: string,
    method?: Method,
): [string | undefined, (val: string | undefined) => void] {
    const [query, updateQuery] = useQuery(method)
    const rawValue = query[paramName]
    const value = Array.isArray(rawValue) ? rawValue[0] : (rawValue as string | undefined)

    const setValue = useCallback(
        (val: string | undefined) => {
            updateQuery({[paramName]: val})
        },
        [paramName, updateQuery],
    )

    return [value ?? defaultValue, setValue]
}
