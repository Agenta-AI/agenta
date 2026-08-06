import {useRouter} from "next/router"

const readParam = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value

/**
 * Home variants. First-run vs returning is driven by agent count (0 → first-run); the
 * `?firstRun=1|0` query param is a dev override for previewing either state.
 */
export function useAgentHomeVariants() {
    const {query} = useRouter()

    const firstRunParam = readParam(query.firstRun)
    const firstRunOverride =
        firstRunParam === "1" || firstRunParam === "true"
            ? true
            : firstRunParam === "0" || firstRunParam === "false"
              ? false
              : undefined

    return {firstRunOverride}
}
