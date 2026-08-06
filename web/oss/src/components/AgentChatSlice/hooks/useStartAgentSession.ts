import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {urlAtom} from "@/oss/state/url"

import {agentFirstRunSeedAtom} from "../state/firstRunSeed"
import {pendingSessionOpenAtom} from "../state/pendingSessionOpen"

/**
 * Start a NEW conversation with an existing agent, seeded with what the user typed — the daily
 * action, as opposed to creating an agent, which happens once.
 *
 * Two carriers ride the navigation: the pending-open slot (no session id = "open a fresh session
 * here") and the first-run seed (the message, sent as soon as the model is ready). Together they
 * land the user in a new conversation with their request already in flight.
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
            setPendingOpen({appId})
            // `autoSend`: the user already pressed Start, so asking them to press it again on the
            // other side would be the same decision twice.
            // Files alone are a valid send: the chat holds the turn until they finish uploading.
            if (seedMessage || files?.length)
                setSeed({appId, seedMessage, autoSend: true, seedFiles: files})

            router.push(`${baseAppURL}/${appId}/playground`).catch(() => {
                setPendingOpen(null)
                setSeed(null)
            })
        },
        [router, baseAppURL, setPendingOpen, setSeed],
    )
}
