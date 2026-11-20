/**
 * The automatic key check: one probe at a time, which "Stop" or a new edit can drop.
 *
 * The form starts a check by itself (a paste, a blur after an edit, opening a saved connection,
 * "Check again", "Update"); there is no "Test" button. A dropped check aborts its request and its
 * answer is ignored even when it still arrives. The probe never sends a generation request.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {
    probeProviderMutationAtom,
    type probeRequestFor,
    type ProbeProviderResponse,
} from "@agenta/entities/secret"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

/** One probe request, and whether it reads a stored organization connection. */
export type KeyCheckRequest = ReturnType<typeof probeRequestFor> & {
    secretScope?: "organization"
}

export type KeyCheckState =
    | {phase: "idle"}
    | {phase: "checking"; signature: string}
    | {phase: "done"; signature: string; result: ProbeProviderResponse}
    /** The request failed, or the answer did not fit the schema (`error` is null then). */
    | {phase: "failed"; signature: string; error: unknown}

/** The identity of a request: a check of the same request is a duplicate. */
export const keyCheckSignature = (request: KeyCheckRequest): string => JSON.stringify(request)

export interface KeyCheck {
    state: KeyCheckState
    /** Starts a check; a running one is dropped first. */
    check: (request: KeyCheckRequest) => void
    /** Drops the running check and the last answer ("Stop", or an edit of a credential field). */
    drop: () => void
    /** False until the project is known: no check can run. */
    ready: boolean
}

export function useKeyCheck(): KeyCheck {
    const projectId = useAtomValue(projectIdAtom)
    const probe = useAtomValue(probeProviderMutationAtom)
    // The mutation result changes on every render; the check reads the latest one.
    const probeRef = useRef(probe)
    probeRef.current = probe
    const [state, setState] = useState<KeyCheckState>({phase: "idle"})
    const controller = useRef<AbortController | null>(null)
    // Each check has a number; an answer whose number is not the latest is ignored.
    const latest = useRef(0)

    const drop = useCallback(() => {
        controller.current?.abort()
        controller.current = null
        latest.current += 1
        setState({phase: "idle"})
    }, [])

    const check = useCallback(
        (request: KeyCheckRequest) => {
            if (!projectId) return
            controller.current?.abort()
            const own = new AbortController()
            controller.current = own
            const id = (latest.current += 1)
            const signature = keyCheckSignature(request)
            setState({phase: "checking", signature})
            // Through a resolved promise, so a client that throws at once fails like one that
            // rejects later.
            Promise.resolve()
                .then(() =>
                    probeRef.current.mutateAsync({
                        projectId,
                        kind: request.kind,
                        provider: request.provider,
                        secretId: request.secret_id,
                        ...(request.secretScope ? {secretScope: request.secretScope} : {}),
                        signal: own.signal,
                    }),
                )
                .then(
                    (result) => {
                        if (id !== latest.current) return
                        setState(
                            result
                                ? {phase: "done", signature, result}
                                : {phase: "failed", signature, error: null},
                        )
                    },
                    (error: unknown) => {
                        if (id !== latest.current) return
                        setState({phase: "failed", signature, error})
                    },
                )
                .finally(() => {
                    if (controller.current === own) controller.current = null
                })
        },
        [projectId],
    )

    // A form that closes takes its running check with it.
    useEffect(() => () => controller.current?.abort(), [])

    return {state, check, drop, ready: !!projectId}
}
