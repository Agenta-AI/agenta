import {useCallback} from "react"

import {pendingSessionOpenAtom} from "@agenta/sessions/state"
import {generateId} from "@agenta/shared/utils"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {urlAtom} from "@/oss/state/url"

import {agentFirstRunSeedAtom} from "../state/firstRunSeed"

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
    const setPendingOpen = useSetAtom(pendingSessionOpenAtom)
    const setSeed = useSetAtom(agentFirstRunSeedAtom)

    return useCallback(
        ({appId, message, files}) => {
            const seedMessage = message.trim()
            // Minted here so both carriers name the same session: the playground creates THIS id,
            // and the message is claimed by it alone — never by whichever session was open last.
            const sessionId = generateId()
            setPendingOpen({appId, newSessionId: sessionId})
            // `autoSend`: the user already pressed Start, so asking them to press it again on the
            // other side would be the same decision twice.
            // Files alone are a valid send: the chat holds the turn until they finish uploading.
            if (seedMessage || files?.length)
                setSeed({appId, sessionId, seedMessage, autoSend: true, seedFiles: files})

            router.push(`${baseAppURL}/${appId}/playground`).catch(() => {
                setPendingOpen(null)
                setSeed(null)
            })
        },
        [router, baseAppURL, setPendingOpen, setSeed],
    )
}
