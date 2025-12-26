import {atom, getDefaultStore} from "jotai"
import Router from "next/router"

const isBrowser = typeof window !== "undefined"

// Atom to track testcase_id from URL
export const testcaseIdAtom = atom<string | undefined>(undefined)

// Check if route supports testcase drawer
const isTestcaseSupportedRoute = (pathname: string) => pathname.includes("/testsets")

export const clearTestcaseDrawerState = () => {
    const store = getDefaultStore()
    store.set(testcaseIdAtom, undefined)
}

export const syncTestcaseStateFromUrl = (nextUrl?: string) => {
    if (!isBrowser) return

    try {
        const store = getDefaultStore()
        const url = new URL(nextUrl ?? window.location.href, window.location.origin)
        const testcaseParam = url.searchParams.get("testcase_id") ?? undefined
        const routeSupportsTestcase = isTestcaseSupportedRoute(url.pathname)
        const currentTestcaseId = store.get(testcaseIdAtom)

        // If route doesn't support testcase param, remove it from URL
        if (!routeSupportsTestcase) {
            if (testcaseParam) {
                url.searchParams.delete("testcase_id")
                const newPath = `${url.pathname}${url.search}${url.hash}`
                void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
                    console.error("Failed to remove unsupported testcase query param:", error)
                })
            }
            if (currentTestcaseId !== undefined) {
                clearTestcaseDrawerState()
            }
            return
        }

        // If no testcase param, clear state
        if (!testcaseParam) {
            if (currentTestcaseId !== undefined) {
                clearTestcaseDrawerState()
            }
            return
        }

        // If already synced, skip
        if (currentTestcaseId === testcaseParam) {
            return
        }

        // Sync testcase ID from URL
        store.set(testcaseIdAtom, testcaseParam)
    } catch (err) {
        console.error("Failed to sync testcase state from URL:", nextUrl, err)
    }
}

export const clearTestcaseQueryParam = () => {
    if (!isBrowser) return
    try {
        const url = new URL(window.location.href)
        if (!url.searchParams.has("testcase_id")) return

        url.searchParams.delete("testcase_id")
        const newPath = `${url.pathname}${url.search}${url.hash}`
        void Router.replace(newPath, undefined, {shallow: true}).catch((error) => {
            console.error("Failed to clear testcase query param:", error)
        })
    } catch (err) {
        console.error("Failed to clear testcase query param:", err)
    }
}

export const clearTestcaseParamAtom = atom(null, (_get, _set) => {
    // Clear atom state synchronously first to prevent re-open from useEffect
    clearTestcaseDrawerState()
    // Then clear URL param
    clearTestcaseQueryParam()
})
