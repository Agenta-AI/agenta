/**
 * Next.js 15 instrumentation hook — Pages Router edition.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ instrumentation.ts is supported in Pages Router since       │
 *   │ Next 15 (same hook as App Router). Verified by this spike — │
 *   │ no Pages-specific syntax or location difference.            │
 *   │                                                             │
 *   │ Mechanism identical to nextjs-app-router-raw: dispatch by   │
 *   │ NEXT_RUNTIME, defer Node-only OTel setup to                 │
 *   │ ./instrumentation.node.ts.                                  │
 *   └─────────────────────────────────────────────────────────────┘
 */

export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        await import("./instrumentation.node")
    }
}
