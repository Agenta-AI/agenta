/**
 * Client chat page — exercises useChat against /api/chat.
 *
 * Tagged with a per-load run ID via x-agenta-run-id header so every
 * chat session is independently queryable in Agenta. Plain HTML/CSS,
 * no styling library — the spike is about tracing, not aesthetics.
 */

"use client"

import {useMemo, useState} from "react"

import {useChat} from "@ai-sdk/react"
import {DefaultChatTransport} from "ai"

export default function ChatPage(): React.ReactElement {
    const runId = useMemo(() => `chat-${Date.now()}`, [])
    const transport = useMemo(
        () =>
            new DefaultChatTransport({
                api: "/api/chat",
                headers: {"x-agenta-run-id": runId},
            }),
        [runId],
    )
    const {messages, sendMessage, status, stop} = useChat({transport})
    const [input, setInput] = useState("")

    const submit = (e: React.FormEvent): void => {
        e.preventDefault()
        if (!input.trim()) return
        sendMessage({text: input})
        setInput("")
    }

    return (
        <main style={{padding: 24, maxWidth: 720, margin: "0 auto", fontFamily: "system-ui"}}>
            <h1 style={{fontSize: 18}}>Chat — App Router (raw OTel)</h1>
            <p style={{color: "#666", fontSize: 13}}>
                run id: <code>{runId}</code> · status: <code>{status}</code>
            </p>
            <ul style={{listStyle: "none", padding: 0}}>
                {messages.map((m) => (
                    <li
                        key={m.id}
                        style={{
                            margin: "12px 0",
                            padding: 12,
                            background: m.role === "user" ? "#f4f4f5" : "#eef6ff",
                            borderRadius: 6,
                        }}
                    >
                        <strong style={{textTransform: "uppercase", fontSize: 11, color: "#666"}}>
                            {m.role}
                        </strong>
                        <div>
                            {m.parts.map((part, i) =>
                                part.type === "text" ? <span key={i}>{part.text}</span> : null,
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            <form onSubmit={submit} style={{display: "flex", gap: 8, marginTop: 24}}>
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Say something…"
                    disabled={status !== "ready"}
                    style={{flex: 1, padding: 8, border: "1px solid #ccc", borderRadius: 4}}
                />
                <button
                    type="submit"
                    disabled={status !== "ready" || !input.trim()}
                    style={{padding: "8px 16px"}}
                >
                    Send
                </button>
                {status === "streaming" && (
                    <button type="button" onClick={() => stop()} style={{padding: "8px 16px"}}>
                        Stop
                    </button>
                )}
            </form>
        </main>
    )
}
