/**
 * Landing page — links to the other probe routes.
 */

import Link from "next/link"

export default function HomePage(): React.ReactElement {
    return (
        <main style={{padding: 24, maxWidth: 720, margin: "0 auto", fontFamily: "system-ui"}}>
            <h1 style={{fontSize: 20}}>App Router Spike — raw OTel</h1>
            <p style={{color: "#666"}}>
                Next.js 15 + AI SDK v6 + raw OpenTelemetry. Tracing wired via{" "}
                <code>instrumentation.ts</code> + per-app sentinel.
            </p>
            <ul>
                <li>
                    <Link href="/chat">/chat</Link> — useChat client UI hitting{" "}
                    <code>/api/chat</code> (streaming)
                </li>
                <li>
                    <Link href="/server-action-test">/server-action-test</Link> — Server Action
                    calling generateText directly
                </li>
                <li>
                    <code>/api/edge-chat</code> — edge runtime route (POST only)
                </li>
            </ul>
        </main>
    )
}
