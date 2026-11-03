import {type ReactNode, useLayoutEffect, useRef, useState} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {Segmented, SplitPane} from "@agenta/ui/ui"

type Pane = "config" | "runs"

const PANES: {value: Pane; label: string}[] = [
    {value: "config", label: "Configuration"},
    {value: "runs", label: "Generations"},
]

/** The config pane starts at half the width, and may take 320px to 70% of it. */
const CONFIG_SHARE = 0.5
const CONFIG_MIN = 320
const CONFIG_MAX_SHARE = 0.7

/**
 * The config pane and the run pane. From `md` up they sit side by side with a divider to resize
 * them; below `md` one shows at a time, picked with a Configuration / Generations switch.
 */
export const PlaygroundSplit = ({config, runs}: {config: ReactNode; runs: ReactNode}) => {
    const twoPane = useMediaQuery("(min-width: 768px)")
    const [pane, setPane] = useState<Pane>("config")
    const frameRef = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    const [share, setShare] = useState(CONFIG_SHARE)

    useLayoutEffect(() => {
        const frame = frameRef.current
        if (!twoPane || !frame) return
        const read = () => setWidth(frame.getBoundingClientRect().width)
        read()
        if (typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(read)
        observer.observe(frame)
        return () => observer.disconnect()
    }, [twoPane])

    if (!twoPane) {
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-border px-4 py-2">
                    <Segmented
                        block
                        size="sm"
                        options={PANES}
                        value={pane}
                        onChange={(value) => setPane(value as Pane)}
                    />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {pane === "config" ? config : runs}
                </div>
            </div>
        )
    }

    return (
        <div ref={frameRef} className="min-h-0 flex-1">
            <SplitPane
                className="h-full"
                paneSide="start"
                paneSize={Math.round(width * share)}
                paneMin={CONFIG_MIN}
                paneMax={Math.round(width * CONFIG_MAX_SHARE)}
                onResize={(size, total) => {
                    if (total > 0) setShare(size / total)
                }}
                paneClassName="overflow-y-auto"
                fillClassName="overflow-y-auto"
                pane={config}
                fill={runs}
            />
        </div>
    )
}
