/**
 * Next.js 15 instrumentation hook.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ ENTRY POINT: ./instrumentation.ts at the project root,      │
 *   │ Next.js auto-discovers and calls register() before the      │
 *   │ first request handler runs.                                 │
 *   │                                                             │
 *   │ NEXT_RUNTIME tells us which runtime is registering — Next   │
 *   │ runs `instrumentation.ts` once per runtime (`nodejs` and    │
 *   │ `edge` if any route opts into edge). We only set up Node    │
 *   │ here; the edge route uses `instrumentation-edge.ts` via the │
 *   │ same dispatch.                                              │
 *   └─────────────────────────────────────────────────────────────┘
 */

export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        await import("./instrumentation.node")
    }
    // Edge runtime instrumentation lives in the edge route file itself
    // (per Next 15 — instrumentation hook can't load Node-only OTel libs
    // from the edge instance). See app/api/edge-chat/route.ts.
}
