import {memo} from "react"

import {Button} from "antd"

interface RunOverlayProps {
    isRunning: boolean
    onRun: () => void
}

const RunOverlay = ({isRunning, onRun}: RunOverlayProps) => {
    return (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 dark:bg-[#141414]/90 backdrop-blur-md rounded-lg">
            <span className="mb-4 text-center px-4 font-medium text-muted-foreground">
                {isRunning ? "Generating output..." : "Generate output to annotate"}
            </span>
            <div className="flex gap-4 items-center mt-1">
                <Button type="primary" onClick={onRun} loading={isRunning} disabled={isRunning}>
                    {isRunning ? "Running..." : "Run"}
                </Button>
                {!isRunning && (
                    <span className="text-xs text-neutral-400 text-muted-foreground">
                        or press{" "}
                        <kbd className="px-1.5 py-0.5 text-xs font-semibold text-neutral-600 bg-neutral-100 border border-neutral-300 rounded">
                            ⌘
                        </kbd>{" "}
                        <kbd className="px-1.5 py-0.5 text-xs font-semibold text-neutral-600 bg-neutral-100 border border-neutral-300 rounded">
                            Enter
                        </kbd>
                    </span>
                )}
            </div>
        </div>
    )
}

export default memo(RunOverlay)
