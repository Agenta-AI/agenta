import {type MutableRefObject, useEffect, useRef, useState} from "react"

import {workflowBuildKitOverlayReadyAtomFamily} from "@agenta/entities/workflow"
import {useAtom, useAtomValue} from "jotai"

import {agentFirstRunSeedAtom} from "../state/firstRunSeed"

/**
 * First-run seed: a freshly-created agent (from Home's composer/template) surfaces its starting
 * prompt in the empty state (see AgentChatEmptyState) rather than pre-filling the composer, so it
 * reads as "here's what we'll do" not stray user input. Consumed once by the active session on a
 * fresh conversation, matching either the revision or app id, then cleared.
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
}: {
    entityId: string
    /** The chat scope — an app id. Lets a seed aimed at an existing agent match without knowing
     * which revision the playground happens to be showing. */
    scopeKey: string
    sessionId: string
    activeSessionId: string | null | undefined
    messagesCount: number
    modelBlocked: boolean
    /** Read at fire time so the transition drives the send, not a stale closure. */
    handleSubmitRef: MutableRefObject<(text: string) => void | Promise<void>>
    /** The chat's own `addFiles` — seed files go through the same staging paste and drop use. */
    onSeedFiles?: (files: File[]) => void
    /** False while seeded files are still staging; the auto-send waits for it, because the
     * conversation's submit silently rejects un-settled attachments. */
    attachmentsSettled?: boolean
}) => {
    const [firstRunSeed, setFirstRunSeed] = useAtom(agentFirstRunSeedAtom)
    const [firstRunPrompt, setFirstRunPrompt] = useState<string | null>(null)
    // An explicit-"go" seed (the onboarding Create-agent click) sends as soon as the model is ready.
    const [firstRunAutoSend, setFirstRunAutoSend] = useState(false)
    const seedConsumedRef = useRef(false)
    useEffect(() => {
        if (seedConsumedRef.current || !firstRunSeed) return
        const addressesThisAgent =
            entityId === firstRunSeed.revisionId ||
            entityId === firstRunSeed.appId ||
            scopeKey === firstRunSeed.appId
        if (!addressesThisAgent) return
        if (activeSessionId !== sessionId || messagesCount > 0) return
        seedConsumedRef.current = true
        setFirstRunPrompt(firstRunSeed.seedMessage)
        setFirstRunAutoSend(!!firstRunSeed.autoSend)
        if (firstRunSeed.seedFiles?.length) onSeedFiles?.(firstRunSeed.seedFiles)
        setFirstRunSeed(null)
    }, [
        firstRunSeed,
        entityId,
        scopeKey,
        activeSessionId,
        sessionId,
        messagesCount,
        setFirstRunSeed,
        onSeedFiles,
    ])

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
        firstRunPrompt != null &&
        attachmentsSettled &&
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
        // `== null` and not falsy: "" is a file-only seed, and it must still send.
        if (firstRunPrompt == null || autoStartedSeedRef.current) return
        if (modelBlocked) {
            seedWasBlockedRef.current = true
            return
        }
        if ((!seedWasBlockedRef.current && !firstRunAutoSend) || messagesCount > 0) return
        // Hold the auto-send until the build-kit overlay settles (or the 10s bound elapses).
        if (!overlayReady && !overlayWaitElapsed) return
        // Wait for seeded files to finish staging — the submit rejects while they upload, and
        // this ref must not mark the seed sent on a rejected call.
        if (!attachmentsSettled) return
        autoStartedSeedRef.current = true
        handleSubmitRef.current(firstRunPrompt)
    }, [
        firstRunPrompt,
        firstRunAutoSend,
        modelBlocked,
        messagesCount,
        overlayReady,
        overlayWaitElapsed,
        attachmentsSettled,
    ])

    return {firstRunPrompt}
}
