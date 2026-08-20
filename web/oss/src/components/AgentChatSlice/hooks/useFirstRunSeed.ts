import {type MutableRefObject, useEffect, useRef, useState} from "react"

import {workflowBuildKitOverlayReadyAtomFamily} from "@agenta/entities/workflow"
import {useAtomValue, useSetAtom} from "jotai"

import {
    agentFirstRunSeedsAtom,
    removeFirstRunSeedAtom,
    type AgentFirstRunSeed,
} from "../state/firstRunSeed"

/**
 * Does THIS session own the pending seed?
 *
 * A seed that names its session is claimed by that session alone. The id-less legacy seed (agent
 * creation) falls back to "the active conversation, while it is empty" — and must wait out
 * hydration, because a session whose transcript is still loading is indistinguishable from an empty
 * one and would swallow the message.
 */
export const shouldConsumeSeed = ({
    seed,
    entityId,
    scopeKey,
    sessionId,
    activeSessionId,
    messagesCount,
    isHydrating,
}: {
    seed: AgentFirstRunSeed | null
    entityId: string
    scopeKey: string
    sessionId: string
    activeSessionId: string | null | undefined
    messagesCount: number
    isHydrating: boolean
}): boolean => {
    if (!seed) return false
    const addressesThisAgent =
        entityId === seed.revisionId || entityId === seed.appId || scopeKey === seed.appId
    if (!addressesThisAgent) return false
    if (seed.sessionId) return seed.sessionId === sessionId
    if (activeSessionId !== sessionId) return false
    return !isHydrating && messagesCount === 0
}

/**
 * First-run seed: a freshly-created agent (from Home's composer/template) surfaces its starting
 * prompt in the empty state (see AgentChatEmptyState) rather than pre-filling the composer, so it
 * reads as "here's what we'll do" not stray user input. Consumed once — by the session the seed
 * names, or (id-less agent-creation seed) by the active empty conversation — then cleared.
 *
 * Also owns the auto-start: the seeded agent's model is usually gated (no provider key yet), and
 * connecting the key IS the go-ahead — so once the gate clears the seed sends itself rather than
 * making the user click Start a second time ("no explicit action twice").
 */
export const useFirstRunSeed = ({
    entityId,
    scopeKey,
    sessionId,
    activeSessionId,
    messagesCount,
    modelBlocked,
    handleSubmitRef,
    onSeedFiles,
    attachmentsSettled = true,
    isHydrating = false,
}: {
    entityId: string
    /** The chat scope — an app id. Lets a seed aimed at an existing agent match without knowing
     * which revision the playground happens to be showing. */
    scopeKey: string
    sessionId: string
    activeSessionId: string | null | undefined
    messagesCount: number
    modelBlocked: boolean
    /** True while this session's transcript loads from the durable log — an empty `messagesCount`
     * says nothing yet, so an id-less seed must not read it as an empty conversation. */
    isHydrating?: boolean
    /** Attachments finished uploading — a seed must not fire mid-upload. */
    attachmentsSettled?: boolean
    /** Read at fire time so the transition drives the send, not a stale closure. */
    handleSubmitRef: MutableRefObject<(text: string) => void | Promise<void>>
    /** The chat's own `addFiles` — seed files go through the same staging paste and drop use. */
    onSeedFiles?: (files: File[]) => void
}) => {
    const seeds = useAtomValue(agentFirstRunSeedsAtom)
    const removeSeed = useSetAtom(removeFirstRunSeedAtom)
    const [firstRunPrompt, setFirstRunPrompt] = useState<string | null>(null)
    // An explicit-"go" seed (the onboarding Create-agent click) sends as soon as the model is ready.
    const [firstRunAutoSend, setFirstRunAutoSend] = useState(false)
    const seedConsumedRef = useRef(false)
    // The seed this conversation claimed but has not yet turned into a real message.
    const claimedSeedRef = useRef<AgentFirstRunSeed | null>(null)
    useEffect(() => {
        if (seedConsumedRef.current) return
        const seed = seeds.find((s) =>
            shouldConsumeSeed({
                seed: s,
                entityId,
                scopeKey,
                sessionId,
                activeSessionId,
                messagesCount,
                isHydrating,
            }),
        )
        if (!seed) return
        seedConsumedRef.current = true
        claimedSeedRef.current = seed
        setFirstRunPrompt(seed.seedMessage)
        setFirstRunAutoSend(!!seed.autoSend)
        if (seed.seedFiles?.length) onSeedFiles?.(seed.seedFiles)
    }, [
        seeds,
        entityId,
        scopeKey,
        activeSessionId,
        sessionId,
        messagesCount,
        isHydrating,
        onSeedFiles,
    ])

    // The seed leaves the global list only once this conversation actually CARRIES a message —
    // dispatch confirmed. Clearing at claim time lost the message whenever the pane unmounted
    // during the model/overlay wait below (#6042); parked, it survives the remount and retries.
    useEffect(() => {
        if (messagesCount === 0 || !claimedSeedRef.current) return
        removeSeed(claimedSeedRef.current)
        claimedSeedRef.current = null
    }, [messagesCount, removeSeed])

    // Fires once, while the conversation is still empty, when EITHER: the model just unblocked (was
    // gated), OR the seed is an explicit "go" (`firstRunAutoSend` — the onboarding Create-agent
    // click) and the model is ready. A redirect-seed that merely arrived with a ready model still
    // waits for Start.
    const autoStartedSeedRef = useRef(false)
    const seedWasBlockedRef = useRef(false)
    // Turn 1 must run WITH the build-kit overlay, but the overlay fetch can resolve after the seed
    // lands — so gate the auto-send on the overlay having settled (present or definitively absent).
    const overlayReady = useAtomValue(workflowBuildKitOverlayReadyAtomFamily(entityId))
    // Bounded wait: a broken overlay endpoint must not hang the first turn forever. Once a seed is
    // pending, wait at most 10s for the overlay, then send anyway (kit-less) with a warning.
    const [overlayWaitElapsed, setOverlayWaitElapsed] = useState(false)
    // A new entity/session or a fresh pending seed restarts the bounded wait from zero.
    useEffect(() => {
        setOverlayWaitElapsed(false)
    }, [entityId, firstRunPrompt])
    // Arm the timeout only when the auto-send is blocked on nothing BUT the overlay: a pending seed
    // whose model is ready and which would otherwise fire this turn. Otherwise a still-gated model
    // (or an already-sent seed) would burn the 10s window before the overlay ever mattered.
    const sendBlockedOnlyOnOverlay =
        Boolean(firstRunPrompt) &&
        !autoStartedSeedRef.current &&
        !modelBlocked &&
        (seedWasBlockedRef.current || firstRunAutoSend) &&
        messagesCount === 0 &&
        !overlayReady
    useEffect(() => {
        if (!sendBlockedOnlyOnOverlay || overlayWaitElapsed) return
        const timer = setTimeout(() => {
            console.warn(
                "[AgentChat] build-kit overlay not ready after 10s; sending seed without it",
            )
            setOverlayWaitElapsed(true)
        }, 10_000)
        return () => clearTimeout(timer)
    }, [sendBlockedOnlyOnOverlay, overlayWaitElapsed])
    useEffect(() => {
        if (!firstRunPrompt || autoStartedSeedRef.current) return
        if (modelBlocked) {
            seedWasBlockedRef.current = true
            return
        }
        if ((!seedWasBlockedRef.current && !firstRunAutoSend) || messagesCount > 0) return
        // Hold the auto-send until the build-kit overlay settles (or the 10s bound elapses).
        if (!overlayReady && !overlayWaitElapsed) return
        autoStartedSeedRef.current = true
        handleSubmitRef.current(firstRunPrompt)
    }, [
        firstRunPrompt,
        firstRunAutoSend,
        modelBlocked,
        messagesCount,
        overlayReady,
        overlayWaitElapsed,
    ])

    return {firstRunPrompt}
}
