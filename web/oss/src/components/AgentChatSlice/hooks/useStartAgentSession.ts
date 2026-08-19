import {useCallback} from "react"

import {generateId} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {urlAtom} from "@/oss/state/url"

import {addFirstRunSeedAtom, removeFirstRunSeedAtom} from "../state/firstRunSeed"
import {addPendingSessionOpenAtom, removePendingSessionOpensAtom} from "../state/pendingSessionOpen"

/**
 * Start a NEW conversation with an existing agent, seeded with what the user typed — the daily
 * action, as opposed to creating an agent, which happens once.
 *
 * Two carriers ride the navigation: the pending-open slot ("create a fresh session, under this id")
 * and the first-run seed (the message for that same id, sent as soon as the model is ready).
 * Together they land the user in a new conversation with their request already in flight.
 */
export function useStartAgentSession(): (input: {
    appId: string
    message: string
    files?: File[]
}) => void {
    const router = useRouter()
    const {baseAppURL} = useAtomValue(urlAtom)
    const addPendingOpen = useSetAtom(addPendingSessionOpenAtom)
    const removePendingOpens = useSetAtom(removePendingSessionOpensAtom)
    const addSeed = useSetAtom(addFirstRunSeedAtom)
    const removeSeed = useSetAtom(removeFirstRunSeedAtom)

    return useCallback(
        ({appId, message, files}) => {
            const seedMessage = message.trim()
            // Minted here so both carriers name the same session: the playground creates THIS id,
            // and the message is claimed by it alone — never by whichever session was open last.
            const sessionId = generateId()
            const pendingOpen = {appId, newSessionId: sessionId}
            addPendingOpen(pendingOpen)
            // `autoSend`: the user already pressed Start, so asking them to press it again on the
            // other side would be the same decision twice.
            // Files alone are a valid send: the chat holds the turn until they finish uploading.
            const seed =
                seedMessage || files?.length
                    ? {appId, sessionId, seedMessage, autoSend: true, seedFiles: files}
                    : null
            if (seed) addSeed(seed)

            // Remove only OUR entries on a failed navigation — another create may be in flight.
            router.push(`${baseAppURL}/${appId}/playground`).catch(() => {
                removePendingOpens([pendingOpen])
                if (seed) removeSeed(seed)
            })
        },
        [router, baseAppURL, addPendingOpen, removePendingOpens, addSeed, removeSeed],
    )
}
