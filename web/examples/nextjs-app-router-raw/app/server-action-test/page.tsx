/**
 * Server Action probe page — submitting the form invokes generateAction
 * directly (no /api route round-trip), exercising the RSC context path.
 *
 * Useful for manual testing in the browser; assertion-1 hits the same
 * Server Action programmatically.
 */

import {generateAction} from "../actions/generate"

export default function ServerActionTestPage(): React.ReactElement {
    return (
        <main style={{padding: 24, maxWidth: 720, margin: "0 auto", fontFamily: "system-ui"}}>
            <h1 style={{fontSize: 18}}>Server Action probe — App Router (raw OTel)</h1>
            <p style={{color: "#666", fontSize: 13}}>
                Submitting this form invokes <code>generateAction()</code> directly via React Server
                Actions. Per-action telemetry should round-trip into Agenta with the form-supplied{" "}
                <code>runId</code>.
            </p>
            <form action={runAndLog}>
                <input
                    name="runId"
                    defaultValue={`browser-${Date.now()}`}
                    style={{display: "block", marginBottom: 8, padding: 8, width: "100%"}}
                />
                <textarea
                    name="prompt"
                    rows={3}
                    defaultValue="What's the weather in Berlin? Use the getWeather tool."
                    style={{display: "block", width: "100%", padding: 8, marginBottom: 8}}
                />
                <button type="submit" style={{padding: "8px 16px"}}>
                    Run Server Action
                </button>
            </form>
        </main>
    )
}

// Tiny adapter that lets the form submit return null (Next form actions
// expect void). The Server Action's return value isn't used by the page;
// the trace-side outcome lives in Agenta.
async function runAndLog(formData: FormData): Promise<void> {
    "use server"
    const result = await generateAction(formData)
    console.log("[server-action-test] result:", result)
}
