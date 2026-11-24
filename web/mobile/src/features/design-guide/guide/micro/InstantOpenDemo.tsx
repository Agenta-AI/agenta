import {useState} from "react"

import {Button, Kbd} from "@agenta/ui/ui"

/** MICRO-04: a keyboard-opened panel appears at once, or makes the person wait for an animation. */
export function InstantOpenDemo({instant}: {instant: boolean}) {
    const [open, setOpen] = useState(false)
    return (
        <div className="flex w-full max-w-64 flex-col items-center gap-3">
            <Button variant="outline" onClick={() => setOpen((v) => !v)}>
                Search <Kbd>⌘K</Kbd>
            </Button>
            <div
                className="w-full rounded-md bg-popover px-3 py-2 text-label text-muted-foreground shadow-overlay motion-reduce:transition-none"
                style={{
                    opacity: open ? 1 : 0,
                    transform: open || instant ? "none" : "scale(0.9)",
                    transition: instant ? "none" : "opacity 600ms ease-in-out, transform 600ms ease-in-out",
                }}
            >
                Search agents, sessions…
            </div>
        </div>
    )
}
