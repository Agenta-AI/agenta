import {useCallback, useEffect, useMemo, useRef, useState, type RefObject} from "react"

import {transcriptToMessages} from "@agenta/chat/assets"
import {
    completeSessionDurableEventReplay,
    createSessionDurableEventState,
    createSessionLivePreviewState,
    getPendingApprovals,
    markSessionLivePreviewTerminal,
    reduceSessionDurableEvent,
    reduceSessionLivePreview,
    retireCoveredSessionLivePreview,
    sessionLivePreviewMessages,
    shouldRefetchSessionTranscript,
} from "@agenta/chat/model"
import {useQuery} from "@tanstack/react-query"
import type {UIMessage} from "ai"

import {EmbedRequestError, type EmbedClient, type EmbedConversation} from "./embedClient"
import {
    REPLY_FAILED_TEXT,
    choiceToken,
    currentConversation,
    isAwaitingSatisfied,
    latestRecordSequence,
    optimisticUserMessage,
    recordedEntityIds,
    sendOutcome,
    unrecordedSends,
    userMessageCount,
    type EmbedAwaiting,
    type PendingSends,
} from "./embedConversationModel"
import {fileToUpload, newRequestId} from "./embedFiles"
import type {HostDetails} from "./useEmbedVisitor"

/** D12: after a first message or a command, poll the list this often until the change shows. */
const LIST_POLL_MS = 300
/** While a sent message has no running turn, re-read the conversation this often. */
const READ_POLL_MS = 1_000
const AWAIT_TIMEOUT_MS = 20_000
const RECONNECT_DELAY_MS = 2_000
/** A sent message whose turn never shows in the records is given up after this long. */
const SEND_TIMEOUT_MS = 90_000
const ANSWER_TIMEOUT_MS = 30_000
const CHOICE_RETRIES = 10
const CHOICE_RETRY_MS = 500
const TERMINAL_EVENTS = ["execution.stopped", "execution.failed", "execution.lost"]

type ApprovalPhase = {phase: "idle"} | {phase: "responding"} | {phase: "answered"; ids: string[]}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const describeRefusal = (error: unknown): string =>
    error instanceof EmbedRequestError && error.status === 429
        ? `Too many messages. Try again in ${error.retryAfterSeconds ?? 30} seconds.`
        : error instanceof Error
          ? error.message
          : "The message was not sent. Try again."

/** One visitor's chat: the list, the open conversation, live preview, and every action via the ingress. */
export const useEmbedConversation = ({
    client,
    embedId,
    visitorKey,
    host,
}: {
    client: EmbedClient
    embedId: string
    visitorKey: string
    host: RefObject<HostDetails>
}) => {
    const [awaiting, setAwaiting] = useState<EmbedAwaiting | null>(null)
    const [pendingSend, setPendingSend] = useState<PendingSends | null>(null)
    const [running, setRunning] = useState(false)
    const [preview, setPreview] = useState(createSessionLivePreviewState)
    const [approval, setApproval] = useState<ApprovalPhase>({phase: "idle"})
    const [notice, setNotice] = useState<string | null>(null)
    const [unavailable, setUnavailable] = useState(false)

    const list = useQuery({
        queryKey: ["embed", embedId, visitorKey, "conversations"],
        queryFn: client.listConversations,
        refetchInterval: awaiting ? LIST_POLL_MS : false,
        staleTime: Infinity,
    })
    const conversations = list.data
    const refetchList = list.refetch
    const current = currentConversation(conversations)
    // A reopen shows its target at once; the composer waits until the server switched to it.
    const viewing = awaiting?.kind === "session" ? awaiting.target : current

    useEffect(() => {
        if (awaiting && isAwaitingSatisfied(awaiting, conversations)) setAwaiting(null)
    }, [awaiting, conversations])
    useEffect(() => {
        if (!awaiting) return
        const expire = setTimeout(() => {
            setAwaiting((state) => (state === awaiting ? null : state))
            setNotice("The conversation did not open. Try again.")
        }, AWAIT_TIMEOUT_MS)
        return () => clearTimeout(expire)
    }, [awaiting])

    const read = useQuery({
        queryKey: ["embed", embedId, visitorKey, "conversation", viewing?.session_id],
        queryFn: () => client.readConversation(viewing?.thread_id ?? ""),
        enabled: Boolean(viewing),
        staleTime: Infinity,
        // A turn that never starts sends no live event: only a re-read shows it.
        refetchInterval: pendingSend && !running ? READ_POLL_MS : false,
    })
    const records = read.data?.records
    const recordMessages = useMemo(
        () => (records ? (transcriptToMessages(records) ?? []) : []),
        [records],
    )

    for (const error of [list.error, read.error]) {
        if (error instanceof EmbedRequestError && error.status === 401 && !unavailable)
            setUnavailable(true)
    }

    const runningRef = useRef(running)
    runningRef.current = running
    // The records now hold what the preview streamed: retire it, or drop it once the run is over.
    useEffect(() => {
        if (!records) return
        const covered = recordedEntityIds(records)
        setPreview((state) =>
            runningRef.current
                ? retireCoveredSessionLivePreview(state, state, covered, recordMessages)
                : createSessionLivePreviewState(),
        )
    }, [records, recordMessages])

    const unstartedTurns = read.data?.unstartedTurns ?? 0
    useEffect(() => {
        if (!pendingSend) return
        if (pendingSend.sessionId && pendingSend.sessionId !== viewing?.session_id) {
            setPendingSend(null)
            return
        }
        const outcome = sendOutcome(pendingSend, recordMessages, unstartedTurns)
        if (outcome === "waiting") return
        setPendingSend(null)
        if (outcome === "failed") setNotice(REPLY_FAILED_TEXT)
    }, [pendingSend, recordMessages, unstartedTurns, viewing?.session_id])
    useEffect(() => {
        if (!pendingSend) return
        const expire = setTimeout(() => {
            setPendingSend((state) => (state === pendingSend ? null : state))
            setNotice(REPLY_FAILED_TEXT)
        }, SEND_TIMEOUT_MS)
        return () => clearTimeout(expire)
    }, [pendingSend])

    const latestRead = useRef(read)
    latestRead.current = read
    const viewingRef = useRef(viewing)
    viewingRef.current = viewing
    const hasRead = Boolean(read.data)
    const sessionId = viewing?.session_id

    // The live stream of the open conversation, from the records it was read at.
    useEffect(() => {
        if (!sessionId || !hasRead) return
        let disposed = false
        let connection: {close: () => void} | null = null
        let retry: ReturnType<typeof setTimeout> | null = null
        let durable = createSessionDurableEventState(
            latestRecordSequence(latestRead.current.data?.records ?? []),
        )
        setPreview(createSessionLivePreviewState())

        const open = () => {
            const threadId = viewingRef.current?.thread_id
            if (disposed || !threadId) return
            connection = client.connectLive(
                {threadId, sessionId, after: durable.latestSequence},
                {
                    onFrame: (frame) => {
                        setRunning(true)
                        setPreview((state) => reduceSessionLivePreview(state, frame))
                    },
                    onEvent: (event) => {
                        const next = reduceSessionDurableEvent(durable, event)
                        const refetch = shouldRefetchSessionTranscript(durable, next, event)
                        durable = next
                        if (event.type === "execution.started") setRunning(true)
                        if (TERMINAL_EVENTS.includes(event.type)) {
                            setRunning(false)
                            setPreview((state) => markSessionLivePreviewTerminal(state, event))
                        }
                        if (refetch) void latestRead.current.refetch()
                    },
                    onReady: ({watermark}) => {
                        durable = completeSessionDurableEventReplay(durable, watermark)
                    },
                    onDisconnect: ({reason, reconnect}) => {
                        connection = null
                        if (reason === "unauthorized") setUnavailable(true)
                        if (!reconnect || disposed) return
                        retry = setTimeout(() => {
                            // Records may have moved while the stream was down.
                            void latestRead.current.refetch()
                            open()
                        }, RECONNECT_DELAY_MS)
                    },
                },
            )
        }
        open()
        return () => {
            disposed = true
            if (retry) clearTimeout(retry)
            connection?.close()
            setRunning(false)
        }
    }, [client, sessionId, hasRead])

    const messages = useMemo<UIMessage[]>(() => {
        const live = sessionLivePreviewMessages(preview)
        const pending = pendingSend
            ? unrecordedSends(pendingSend, recordMessages).map(optimisticUserMessage)
            : []
        return [...recordMessages, ...pending, ...live]
    }, [recordMessages, pendingSend, preview])

    const pendingApprovals = useMemo(() => getPendingApprovals(recordMessages), [recordMessages])
    const pendingIds = pendingApprovals.map((item) => item.approvalId).join(",")
    useEffect(() => {
        // The card resets once the records show the answered gate is no longer pending.
        setApproval((state) =>
            state.phase === "answered" &&
            !state.ids.some((id) => pendingIds.split(",").includes(id))
                ? {phase: "idle"}
                : state,
        )
    }, [pendingIds])

    useEffect(() => {
        if (approval.phase !== "answered") return
        // An answer the server dropped leaves the gate pending: offer the buttons again.
        const expire = setTimeout(() => setApproval({phase: "idle"}), ANSWER_TIMEOUT_MS)
        return () => clearTimeout(expire)
    }, [approval])

    const send = useCallback(
        async (text: string, files: File[]): Promise<boolean> => {
            setNotice(null)
            // Registered before the request, so a reply that lands meanwhile cannot end its wait.
            const message = {text, fileNames: files.map((file) => file.name)}
            setPendingSend((state) =>
                state
                    ? {...state, messages: [...state.messages, message]}
                    : {
                          sessionId: viewing?.session_id ?? null,
                          userCount: viewing ? userMessageCount(recordMessages) : 0,
                          unstartedTurns: viewing ? unstartedTurns : 0,
                          messages: [message],
                      },
            )
            const refuse = (notice: string) => {
                setPendingSend((state) => {
                    const messages = state?.messages.filter((item) => item !== message) ?? []
                    return state && messages.length ? {...state, messages} : null
                })
                setNotice(notice)
                return false
            }
            try {
                // Another window with the same key may have switched the conversation.
                const fresh = currentConversation((await refetchList()).data)
                if (fresh?.session_id !== viewing?.session_id)
                    return refuse("This chat changed in another window. Check it and send again.")
                const uploads = await Promise.all(files.map(fileToUpload))
                const {displayName, context} = host.current ?? {}
                await client.send({
                    id: newRequestId(),
                    ...(text ? {text} : {}),
                    ...(uploads.length ? {files: uploads} : {}),
                    ...(displayName ? {displayName} : {}),
                    ...(context ? {context} : {}),
                })
            } catch (error) {
                return refuse(describeRefusal(error))
            }
            if (!current) setAwaiting({kind: "thread", previousThreadId: null})
            return true
        },
        [client, current, host, recordMessages, refetchList, unstartedTurns, viewing],
    )

    const command = useCallback(
        async (text: string, next: EmbedAwaiting) => {
            setNotice(null)
            try {
                await client.send({id: newRequestId(), text})
                setAwaiting(next)
            } catch (error) {
                setNotice(describeRefusal(error))
            }
        },
        [client],
    )

    const newChat = useCallback(() => {
        if (!current) return
        void command("!new", {
            kind: "thread",
            previousThreadId: current.thread_id,
        })
    }, [command, current])

    const reopen = useCallback(
        (conversation: EmbedConversation) => {
            if (!current || conversation.session_id === current.session_id) return
            void command(`!use:${conversation.thread_id}`, {
                kind: "session",
                target: conversation,
            })
        },
        [command, current],
    )

    const answerApproval = useCallback(
        async (approved: boolean) => {
            const threadId = viewingRef.current?.thread_id
            if (!threadId) return
            const ids = pendingApprovals.map((item) => item.approvalId)
            setApproval({phase: "responding"})
            setNotice(null)
            try {
                // The outbox writes the choice shortly after the run parks: retry briefly.
                for (let attempt = 0; attempt < CHOICE_RETRIES; attempt += 1) {
                    const token = choiceToken(
                        (await client.readConversation(threadId)).choiceTokens,
                        approved,
                    )
                    if (token) {
                        await client.send({id: newRequestId(), type: "action", token})
                        setApproval({phase: "answered", ids})
                        return
                    }
                    await sleep(CHOICE_RETRY_MS)
                }
                setNotice("The answer could not be sent. Try again.")
            } catch (error) {
                setNotice(describeRefusal(error))
            }
            setApproval({phase: "idle"})
        },
        [client, pendingApprovals],
    )

    const viewingThreadId = viewing?.thread_id ?? ""
    const fileBlob = useCallback(
        (fileId: string) => client.fileBlob(viewingThreadId, fileId),
        [client, viewingThreadId],
    )

    const lastMessage = messages[messages.length - 1]
    return {
        conversations: conversations ?? [],
        // A sent message keeps the transcript, with its dots, while its new conversation loads.
        loading: list.isPending || (Boolean(viewing) && read.isPending && !pendingSend),
        unavailable,
        viewing,
        current,
        messages,
        running,
        /** The reply has not started to show yet. */
        waitingForReply:
            (running || Boolean(pendingSend)) && (!lastMessage || lastMessage.role === "user"),
        switching: Boolean(awaiting),
        notice,
        dismissNotice: () => setNotice(null),
        pendingApprovals,
        approvalResponding: approval.phase === "responding",
        approvalAnswered: approval.phase === "answered",
        send,
        newChat,
        reopen,
        answerApproval,
        fileBlob,
    }
}
