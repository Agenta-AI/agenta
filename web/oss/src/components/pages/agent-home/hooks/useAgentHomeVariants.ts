import {useRouter} from "next/router"

const readParam = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value

/**
 * Home variants. First-run vs returning is driven by agent count (0 → first-run); the
 * `?firstRun=1|0` query param is a dev override for previewing either state.
 *
 * `?new=1` is not a dev flag: it is how a returning user reaches the create-an-agent surface,
 * which is the same one first-run gets. Creating an agent needs a place of its own — folded into
 * the task composer it was invisible and made send mean two things.
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

    const newParam = readParam(query.new)
    const creatingAgent = newParam === "1" || newParam === "true"

    return {firstRunOverride, creatingAgent}
}
