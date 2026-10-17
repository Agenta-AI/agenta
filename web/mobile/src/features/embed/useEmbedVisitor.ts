import {useEffect, useRef, useState} from "react"

import {allowedParentOrigin, readHostMessage, type HostContext} from "./hostMessages"
import {anonymousVisitorKey, isValidVisitorKey} from "./visitorKey"

/** How long the widget waits for the host's `agenta:init` before it uses its own key. */
export const HOST_INIT_TIMEOUT_MS = 1_000

export type EmbedVisitor =
    | {status: "waiting"}
    | {status: "ready"; visitorKey: string}
    | {status: "refused"}

/** What the host page last told the widget; read at send time, so updates need no render. */
export interface HostDetails {
    displayName?: string
    context?: HostContext
}

const browserStorage = (): Storage | null => {
    try {
        return window.localStorage
    } catch {
        return null
    }
}

/** The host handshake: the host's key from `agenta:init` within one second, else this browser's key. */
export const useEmbedVisitor = ({
    embedId,
    allowedOrigins,
}: {
    embedId: string
    allowedOrigins: readonly string[]
}) => {
    const [visitor, setVisitor] = useState<EmbedVisitor>({status: "waiting"})
    const host = useRef<HostDetails>({})

    useEffect(() => {
        let settled = false
        const settle = (next: EmbedVisitor) => {
            if (settled) return
            settled = true
            setVisitor(next)
        }

        const onMessage = (event: MessageEvent) => {
            const message = readHostMessage(event, {parent: window.parent, allowedOrigins})
            if (!message) return
            if (message.type === "context") {
                host.current = {...host.current, context: message.context}
                return
            }
            host.current = {
                displayName: message.displayName ?? host.current.displayName,
                context: message.context ?? host.current.context,
            }
            // A key that arrives after the fallback is ignored: the conversation already started.
            if (message.visitorKey === undefined) {
                settle({
                    status: "ready",
                    visitorKey: anonymousVisitorKey(embedId, browserStorage()),
                })
            } else if (isValidVisitorKey(message.visitorKey)) {
                settle({status: "ready", visitorKey: message.visitorKey})
            } else {
                settle({status: "refused"})
            }
        }
        window.addEventListener("message", onMessage)

        const parentOrigin =
            window.parent !== window
                ? allowedParentOrigin(
                      {
                          ancestorOrigin: window.location.ancestorOrigins?.[0],
                          referrer: document.referrer,
                      },
                      allowedOrigins,
                  )
                : null
        if (parentOrigin) window.parent.postMessage({type: "agenta:ready"}, parentOrigin)

        const fallback = setTimeout(
            () =>
                settle({
                    status: "ready",
                    visitorKey: anonymousVisitorKey(embedId, browserStorage()),
                }),
            HOST_INIT_TIMEOUT_MS,
        )
        return () => {
            clearTimeout(fallback)
            window.removeEventListener("message", onMessage)
        }
    }, [embedId, allowedOrigins])

    return {visitor, host}
}
