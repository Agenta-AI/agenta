export default function Home() {
    return (
        <main style={{padding: 24, fontFamily: "system-ui, sans-serif"}}>
            <h1>Agenta Workflow Spike</h1>
            <p>
                Verifies tracing behavior with Vercel Workflow DevKit. Hit{" "}
                <code>POST /api/start-plain</code> for the plain AI-SDK-in-a-step
                workflow, or <code>POST /api/start-agent</code> for the DurableAgent
                variant.
            </p>
        </main>
    )
}
