import {useCallback} from "react"

import {useRouter} from "next/router"

/**
 * Read and write the page's query parameters. A write is a shallow replace, so it never reloads
 * the page or adds a history entry. A `null` value removes the parameter.
 */
export const useUrlParams = () => {
    const router = useRouter()

    const read = (name: string): string | null => {
        const value = router.query[name]
        return typeof value === "string" && value ? value : null
    }

    const write = useCallback(
        (patch: Record<string, string | null>) => {
            const query = {...router.query}
            for (const [name, value] of Object.entries(patch)) {
                if (value) query[name] = value
                else delete query[name]
            }
            void router.replace({pathname: router.pathname, query}, undefined, {shallow: true})
        },
        [router],
    )

    return {read, write}
}
