import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"

import {assistantMessageAtomFamily} from "@/oss/state/generation/selectors"

/**
 * Shared hook to read the assistant message node for a given (turnId, revisionId).
 * - In comparison view, pass sessionTurnId (row id) when available; otherwise falls back to logical turnId
 * - In single view, pass variantId as revisionId and logical/session turn id as turnId
 */
export function useAssistantMessage(params: {
    turnId: string
    revisionId?: string
    sessionTurnId?: string
}) {
    const {turnId, revisionId, sessionTurnId} = params
    const effectiveTurnId = sessionTurnId || turnId

    const assistantAtom = useMemo(
        () =>
            revisionId && effectiveTurnId
                ? assistantMessageAtomFamily({turnId: effectiveTurnId, revisionId})
                : atom(null),
        [effectiveTurnId, revisionId],
    )

    return useAtomValue(assistantAtom) as any
}
