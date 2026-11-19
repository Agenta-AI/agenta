/**
 * The one leave guard of the agent layout host (shared contract SC2, design D2 and the
 * agent-panel spec "One leave guard at the agent layout host").
 *
 * Every source of unsaved work registers here: the view stack (an open form with edits), the
 * Files draft guard, the automation guard. A content swap, a panel close and a route change out
 * of the agent call `confirmLeave`; each dirty source asks in turn, in its own words. A source
 * that is not dirty does not ask. `beforeunload` asks the browser when any source is dirty.
 */
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    type ReactNode,
} from "react"

import {useRouter} from "next/router"

/** Why the person is leaving. A source may word its question by it. */
export type LeaveReason = "swap" | "close" | "route"

export interface LeaveSource {
    /** True when this source holds unsaved work. Read at the moment of leaving. */
    isDirty: () => boolean
    /** Ask the person. Resolve true to leave (saved or discarded), false to stay. */
    confirm: (reason: LeaveReason) => Promise<boolean>
}

interface LeaveGuard {
    confirmLeave: (reason: LeaveReason) => Promise<boolean>
    register: (source: LeaveSource) => () => void
}

const LeaveGuardContext = createContext<LeaveGuard | null>(null)

/** Outside an agent layout nothing is guarded: leaving always goes ahead. */
const UNGUARDED: LeaveGuard = {
    confirmLeave: async () => true,
    register: () => () => undefined,
}

export const LeaveGuardProvider = ({
    guardRoute = () => true,
    children,
}: {
    /** Whether a route change to `url` leaves the agent and must ask. Default: every one. */
    guardRoute?: (url: string) => boolean
    children: ReactNode
}) => {
    const router = useRouter()
    const sources = useRef(new Set<LeaveSource>())
    const asking = useRef(false)
    const bypass = useRef(false)
    const guardRouteRef = useRef(guardRoute)
    guardRouteRef.current = guardRoute

    const anyDirty = () => [...sources.current].some((source) => source.isDirty())

    const confirmLeave = useCallback(async (reason: LeaveReason) => {
        // One question at a time: a second leave while one is asking stays put.
        if (asking.current) return false
        asking.current = true
        try {
            for (const source of [...sources.current]) {
                if (source.isDirty() && !(await source.confirm(reason))) return false
            }
            return true
        } finally {
            asking.current = false
        }
    }, [])

    const register = useCallback((source: LeaveSource) => {
        sources.current.add(source)
        return () => {
            sources.current.delete(source)
        }
    }, [])

    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!anyDirty()) return
            event.preventDefault()
            // Older browsers show the prompt only when returnValue is set.
            event.returnValue = ""
        }
        window.addEventListener("beforeunload", onBeforeUnload)
        return () => window.removeEventListener("beforeunload", onBeforeUnload)
    }, [])

    // The Pages Router has no navigation blocker: abort `routeChangeStart` by throwing, ask, and
    // push the same URL again with a one-time bypass (the pattern of `useUnsavedGuard`).
    useEffect(() => {
        const clearBypass = () => {
            bypass.current = false
        }
        const onRouteChangeStart = (url: string, {shallow}: {shallow: boolean}) => {
            if (shallow) return
            if (bypass.current) {
                bypass.current = false
                return
            }
            if (!guardRouteRef.current(url) || !anyDirty()) return
            void confirmLeave("route").then((ok) => {
                if (!ok) return
                bypass.current = true
                void router.push(url).catch(() => undefined)
            })
            router.events.emit("routeChangeError")
            // The Next.js idiom for cancelling a navigation; nothing catches it.
            throw "Route change aborted: there are unsaved changes"
        }
        router.events.on("routeChangeStart", onRouteChangeStart)
        router.events.on("routeChangeComplete", clearBypass)
        router.events.on("routeChangeError", clearBypass)
        return () => {
            router.events.off("routeChangeStart", onRouteChangeStart)
            router.events.off("routeChangeComplete", clearBypass)
            router.events.off("routeChangeError", clearBypass)
        }
    }, [confirmLeave, router])

    const guard = useMemo(() => ({confirmLeave, register}), [confirmLeave, register])
    return <LeaveGuardContext.Provider value={guard}>{children}</LeaveGuardContext.Provider>
}

/** Ask every dirty source before a swap, a close or a navigation. Resolves false to stay. */
export const useConfirmLeave = (): LeaveGuard["confirmLeave"] =>
    (useContext(LeaveGuardContext) ?? UNGUARDED).confirmLeave

/**
 * Register a source of unsaved work while the caller is mounted. The latest `isDirty` and
 * `confirm` are read at leave time, so the caller may pass new closures every render.
 */
export const useLeaveSource = (source: LeaveSource | null): void => {
    const {register} = useContext(LeaveGuardContext) ?? UNGUARDED
    const latest = useRef(source)
    latest.current = source
    const active = source !== null
    useEffect(() => {
        if (!active) return
        return register({
            isDirty: () => latest.current?.isDirty() ?? false,
            confirm: (reason) => latest.current?.confirm(reason) ?? Promise.resolve(true),
        })
    }, [active, register])
}
