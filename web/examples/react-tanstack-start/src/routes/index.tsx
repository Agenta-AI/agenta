/**
 * Home page — minimal useChat UI so we have a manual smoke-test
 * surface in the browser. The assertions run via HTTP against
 * /api/chat directly, so this page is optional for testing.
 */

import {useState} from "react"

import {useChat} from "@ai-sdk/react"
import {createFileRoute} from "@tanstack/react-router"
import {DefaultChatTransport} from "ai"

export const Route = createFileRoute("/")({
    component: HomePage,
})

function HomePage(): React.ReactElement {
    const [input, setInput] = useState("")
    const {messages, sendMessage, status} = useChat({
        transport: new DefaultChatTransport({api: "/api/chat"}),
    })

    return (
        <main
            style={{
                maxWidth: 720,
                margin: "2rem auto",
                padding: "0 1rem",
                fontFamily: "system-ui",
            }}
        >
            <h1>TanStack Start spike — chat</h1>
            <p style={{color: "#666"}}>
                Manual smoke surface. Assertions run via HTTP against /api/chat.
            </p>
            <ul style={{padding: 0, listStyle: "none"}}>
                {messages.map((m) => (
                    <li
                        key={m.id}
                        style={{
                            margin: "0.5rem 0",
                            padding: "0.5rem",
                            border: "1px solid #eee",
                            borderRadius: 6,
                        }}
                    >
                        <strong>{m.role}:</strong>{" "}
                        {m.parts.map((p, i) =>
                            p.type === "text" ? <span key={i}>{p.text}</span> : null,
                        )}
                    </li>
                ))}
            </ul>
            <form
                onSubmit={(e) => {
                    e.preventDefault()
                    if (!input.trim()) return
                    void sendMessage({text: input})
                    setInput("")
                }}
                style={{display: "flex", gap: 8}}
            >
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="say something..."
                    style={{flex: 1, padding: "0.5rem"}}
                />
                <button type="submit" disabled={status === "streaming"}>
                    Send
                </button>
            </form>
        </main>
    )
}
