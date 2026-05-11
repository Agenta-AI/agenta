/**
 * Pages Router landing — links to chat + raw HTTP probes for the edge route.
 *
 * Inline useChat client just like App Router. Same DefaultChatTransport
 * pattern works against both router types — the difference is server-
 * side only (pipeUIMessageStreamToResponse vs toUIMessageStreamResponse).
 */

import {useMemo, useState} from "react"

import {useChat} from "@ai-sdk/react"
import {DefaultChatTransport} from "ai"
import Link from "next/link"

export default function HomePage(): React.ReactElement {
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
            <h1 style={{fontSize: 18}}>Chat — Pages Router (@vercel/otel)</h1>
            <p style={{color: "#666", fontSize: 13}}>
                run id: <code>{runId}</code> · status: <code>{status}</code>
            </p>
            <p style={{color: "#666", fontSize: 13}}>
                Edge route at <code>/api/edge-chat</code> (POST only — use curl). Sentinels at{" "}
                <Link href="/api/sentinels">/api/sentinels</Link>.
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
