import {useCallback, useRef} from "react"

import {executionItemController} from "@agenta/playground"
import {Button, InputNumber, Popover, PopoverContent, PopoverTrigger, Slider} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

interface RunOptionsPopoverProps {
    isRunning: boolean
    entityId: string
    /** Optional analytics callback for tracking repeat count changes */
    onRepeatCountChange?: (event: string, props: Record<string, unknown>) => void
}

const RunOptionsPopover = ({isRunning, onRepeatCountChange}: RunOptionsPopoverProps) => {
    const repetitionCount = useAtomValue(executionItemController.selectors.repetitionCount)
    const setRepetitionCount = useSetAtom(executionItemController.actions.setRepetitionCount)
    const initialCountRef = useRef(repetitionCount)

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (open) {
                initialCountRef.current = repetitionCount
            } else {
                if (repetitionCount !== initialCountRef.current) {
                    onRepeatCountChange?.("playground_repeats_count_changed", {
                        count: repetitionCount,
                    })
                } else if (repetitionCount === 1) {
                    onRepeatCountChange?.("playground_repeats_opened_no_change_default", {count: 1})
                }
            }
        },
        [onRepeatCountChange, repetitionCount],
    )

    const content = (
        <div className="flex flex-col gap-4 w-[300px]">
            <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                    <span className="font-semibold text-colorText">Repeats</span>
                    <InputNumber
                        min={1}
                        max={10}
                        value={repetitionCount}
                        onChange={(val) => setRepetitionCount(val || 1)}
                        size="small"
                        className="w-[60px]"
                        disabled={isRunning}
                    />
                </div>
                <span className="text-xs text-colorTextDescription">
                    Run the same prompt multiple times to reduce variability in results.{" "}
                </span>
                <Slider
                    min={1}
                    max={10}
                    value={[repetitionCount]}
                    onValueChange={([val]) => setRepetitionCount(val)}
                    disabled={isRunning}
                    aria-label="Repeats"
                />
            </div>
        </div>
    )

    return (
        <Popover onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    size="sm"
                    disabled={isRunning}
                    aria-label="Run options"
                    className="w-8 p-0 rounded-l-none border-l border-l-[rgba(255,255,255,0.4)]"
                >
                    <CaretDown size={14} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" side="bottom" className="p-4 w-auto">
                {content}
            </PopoverContent>
        </Popover>
    )
}

export default RunOptionsPopover
