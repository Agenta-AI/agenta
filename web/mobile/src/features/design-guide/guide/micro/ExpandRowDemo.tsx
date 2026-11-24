import {useState} from "react"

import {CollapseCaret} from "@agenta/ui/ui"
import {CaretRightIcon, WrenchIcon} from "@phosphor-icons/react"

/** MICRO-06: a tool-call step in a session; its caret points at the content it opened, or not. */
export function ExpandRowDemo({turns}: {turns: boolean}) {
    const [open, setOpen] = useState(false)
    return (
        <div className="flex w-full max-w-72 flex-col">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 text-left text-label text-foreground hover:bg-accent focus-ring"
            >
                {turns ? (
                    <CollapseCaret open={open} />
                ) : (
                    <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
                )}
                <WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">Called search_web</span>
                <span className="text-meta text-muted-foreground">1.2s</span>
            </button>
            {open ? (
                <div className="ml-7 mt-1 rounded-sm bg-muted px-3 py-2 text-code-sm text-muted-foreground">
                    {`{"query": "agent evals 2026"}`}
                </div>
            ) : null}
        </div>
    )
}
