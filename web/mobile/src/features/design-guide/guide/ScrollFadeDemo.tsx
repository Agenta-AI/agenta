import {useRef} from "react"

import {useScrollFadeEdges} from "@agenta/ui/hooks"

const ROWS = ["Weekly report", "Triage inbox", "Release notes", "Standup summary", "Support digest", "Churn alert", "Docs sync", "Lead scoring"]

/** A short scroll box for LAYOUT-05: `edges` drives the fades from the scroll position, `always` fades both edges. */
export function ScrollFadeDemo({mode}: {mode: "edges" | "always"}) {
    const ref = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(ref, {enabled: mode === "edges"})
    const always = mode === "always"
        ? {maskImage: "linear-gradient(to bottom, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)"}
        : undefined
    return (
        <div ref={ref} className={mode === "edges" ? "ag-scroll-fade h-36 w-56 overflow-y-auto text-left" : "h-36 w-56 overflow-y-auto text-left"} style={always}>
            {ROWS.map((r) => (
                <div key={r} className="flex h-9 items-center px-2 text-label">
                    {r}
                </div>
            ))}
        </div>
    )
}
