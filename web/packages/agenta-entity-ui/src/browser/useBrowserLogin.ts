import {useCallback, useRef, useState} from "react"

import {
    cancelBrowserLoginAtom,
    finishBrowserLoginAtom,
    startBrowserLoginAtom,
    type BrowserProfile,
} from "@agenta/entities/browserProfile"
import {useSetAtom} from "jotai"

export type BrowserLoginState =
    | {phase: "idle"}
    | {phase: "starting"; profile: BrowserProfile}
    | {phase: "live"; profile: BrowserProfile; busy: boolean; error: string | null}
    | {phase: "failed"; profile: BrowserProfile; error: string}

export const messageOf = (cause: unknown, fallback: string) =>
    cause instanceof Error && cause.message ? cause.message : fallback

export const useBrowserLogin = () => {
    const start = useSetAtom(startBrowserLoginAtom)
    const finishLogin = useSetAtom(finishBrowserLoginAtom)
    const cancelLogin = useSetAtom(cancelBrowserLoginAtom)
    const [state, setState] = useState<BrowserLoginState>({phase: "idle"})
    const attemptRef = useRef(0)

    const discard = useCallback(
        (profileId: string) => void cancelLogin(profileId).catch(() => undefined),
        [cancelLogin],
    )

    const open = useCallback(
        async (profile: BrowserProfile) => {
            const attempt = ++attemptRef.current
            setState({phase: "starting", profile})
            try {
                await start(profile.id)
                // Cancelled while the browser started: close the browser that just came up.
                if (attempt !== attemptRef.current) return discard(profile.id)
                setState({phase: "live", profile, busy: false, error: null})
            } catch (cause) {
                if (attempt !== attemptRef.current) return
                setState({
                    phase: "failed",
                    profile,
                    error: messageOf(cause, "Could not start the browser."),
                })
            }
        },
        [start, discard],
    )

    /** True when the login was saved. */
    const finish = useCallback(async (): Promise<boolean> => {
        if (state.phase !== "live") return false
        const {profile} = state
        setState({...state, busy: true, error: null})
        try {
            await finishLogin(profile.id)
            attemptRef.current++
            setState({phase: "idle"})
            return true
        } catch (cause) {
            setState({
                phase: "live",
                profile,
                busy: false,
                error: messageOf(cause, "Could not save the login."),
            })
            return false
        }
    }, [state, finishLogin])

    const cancel = useCallback(() => {
        if (state.phase === "idle") return
        attemptRef.current++
        discard(state.profile.id)
        setState({phase: "idle"})
    }, [state, discard])

    return {state, open, finish, cancel}
}
