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
    /** The person pressed Stop; a blur with the same request does not start it again. */
    | {phase: "stopped"; signature: string}
    | {phase: "checking"; signature: string}
    | {phase: "done"; signature: string; result: ProbeProviderResponse}
    /** The request failed, or the answer did not fit the schema (`error` is null then). */
    | {phase: "failed"; signature: string; error: unknown}

/** The identity of a request: a check of the same request is a duplicate. */
const signatureOf = (request: KeyCheckRequest): string => JSON.stringify(request)

export interface KeyCheck {
    state: KeyCheckState
    /**
     * Starts a check; a running one is dropped first. A request equal to the last one is skipped
     * unless `force` is set (a paste, "Check again", "Update"). Resolves to the answer, or to
     * null when the check was skipped, dropped or could not start.
     */
    check: (request: KeyCheckRequest, options?: {force?: boolean}) => Promise<KeyCheckState | null>
    /** Stop: drops the running check, and the same request is not checked again by itself. */
    stop: () => void
    /** An edit of a credential field: drops the running check and the last answer. */
    drop: () => void
    /** False until the project is known: no check can run. */
    ready: boolean
}

/**
 * Runs the key checks of one form. The same probe also fetches the model list again with a
 * saved key ("Update", and when a saved connection opens).
 */
export function useKeyCheck(): KeyCheck {
    const projectId = useAtomValue(projectIdAtom)
    const probe = useAtomValue(probeProviderMutationAtom)
    // The mutation result changes on every render; the check reads the latest one.
    const probeRef = useRef(probe)
    probeRef.current = probe
    const [state, setStateValue] = useState<KeyCheckState>({phase: "idle"})
    // The latest state for the duplicate rule, read between renders.
    const stateRef = useRef(state)
    const setState = useCallback((next: KeyCheckState) => {
        stateRef.current = next
        setStateValue(next)
    }, [])
    const controller = useRef<AbortController | null>(null)
    // The running check, so a second call for the same request waits on it instead.
    const running = useRef<{signature: string; answer: Promise<KeyCheckState | null>} | null>(null)
    // Each check has a number; an answer whose number is not the latest is ignored.
    const latest = useRef(0)

    const cancel = useCallback(() => {
        controller.current?.abort()
        controller.current = null
        latest.current += 1
    }, [])

    const drop = useCallback(() => {
        cancel()
        setState({phase: "idle"})
    }, [cancel, setState])

    const stop = useCallback(() => {
        const current = stateRef.current
        cancel()
        setState(
            current.phase === "idle" ? current : {phase: "stopped", signature: current.signature},
        )
    }, [cancel, setState])

    const check = useCallback(
        async (
            request: KeyCheckRequest,
            {force = false}: {force?: boolean} = {},
        ): Promise<KeyCheckState | null> => {
            if (!projectId) return null
            const signature = signatureOf(request)
            const current = stateRef.current
            if (!force && current.phase !== "idle" && current.signature === signature) {
                return current.phase === "checking" && running.current?.signature === signature
                    ? running.current.answer
                    : null
            }
            controller.current?.abort()
            const own = new AbortController()
            controller.current = own
            const id = (latest.current += 1)
            setState({phase: "checking", signature})
            const answer = run(projectId, request, signature, own, id)
            running.current = {signature, answer}
            return answer
        },
        [projectId, setState],
    )

    async function run(
        projectId: string,
        request: KeyCheckRequest,
        signature: string,
        own: AbortController,
        id: number,
    ): Promise<KeyCheckState | null> {
        let next: KeyCheckState
        try {
            const result = await probeRef.current.mutateAsync({
                projectId,
                kind: request.kind,
                provider: request.provider,
                secretId: request.secret_id,
                ...(request.secretScope ? {secretScope: request.secretScope} : {}),
                signal: own.signal,
            })
            next = result
                ? {phase: "done", signature, result}
                : {phase: "failed", signature, error: null}
        } catch (error) {
            next = {phase: "failed", signature, error}
        } finally {
            if (controller.current === own) controller.current = null
        }
        if (id !== latest.current) return null
        setState(next)
        return next
    }

    // A form that closes takes its running check with it.
    useEffect(() => () => controller.current?.abort(), [])

    return {state, check, stop, drop, ready: !!projectId}
}
