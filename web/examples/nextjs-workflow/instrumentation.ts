/**
 * Next.js instrumentation hook.
 *
 * Next auto-discovers ./instrumentation.ts at the project root and calls
 * register() before the first request handler runs. We dispatch by
 * NEXT_RUNTIME — only Node here; Workflow DevKit's execution model uses
 * the Functions runtime, so AI calls inside `"use step"` execute in Node.
 */

export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        await import("./instrumentation.node")
    }
}
