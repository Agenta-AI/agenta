import {annotationSessionController, truncateScenarioId} from "@agenta/annotation"
import {message} from "@agenta/ui/app-message"
import {
    Badge,
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {ArrowSquareOut, Copy} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {useIsTraceQueue} from "./useIsTraceQueue"
import {useScenarioTraceOpener} from "./useScenarioTraceOpener"

/**
 * The footer's left side: which item of how many, the item's trace or test case id with a copy
 * action, and for a trace the button that opens it in the trace drawer.
 */
export const FocusScenarioPicker = ({
    scenarioId,
    compact,
}: {
    scenarioId: string
    /** On a narrow screen the trace button lives in the footer's More menu. */
    compact: boolean
}) => {
    const focusIds = useAtomValue(annotationSessionController.selectors.focusScenarioIds())
    const total = useAtomValue(annotationSessionController.selectors.scenarioIds()).length
    const isTraces = useIsTraceQueue()
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    const traceId = isTraces ? traceRef.traceId : ""
    const openTrace = useScenarioTraceOpener(scenarioId)
    const navigateToIndex = useSetAtom(annotationSessionController.actions.navigateToIndex)

    const index = focusIds.indexOf(scenarioId)
    const displayId = traceId || testcaseRef.testcaseId
    const copy = () =>
        void copyToClipboard(displayId).then((copied) => {
            if (copied) message.success("Copied")
        })

    return (
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            <Select
                value={index >= 0 ? String(index) : ""}
                onValueChange={(next) => navigateToIndex(Number(next))}
                disabled={focusIds.length === 0}
            >
                <SelectTrigger size="sm" aria-label="Go to item" className="min-w-[72px]">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {focusIds.map((id, i) => (
                        <SelectItem key={id} value={String(i)}>
                            {`${i + 1} / ${total}`}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {displayId ? (
                <SimpleTooltip title={traceId ? "Copy trace ID" : "Copy testcase ID"}>
                    <button
                        type="button"
                        onClick={copy}
                        className="hidden cursor-pointer border-0 bg-transparent p-0 sm:inline-flex"
                    >
                        <Badge variant="default" className="gap-1.5 font-mono">
                            {truncateScenarioId(displayId)}
                            <Copy aria-hidden size={12} />
                        </Badge>
                    </button>
                </SimpleTooltip>
            ) : null}
            {openTrace && !compact ? (
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Open trace"
                    className="text-muted-foreground"
                    onClick={openTrace}
                >
                    <ArrowSquareOut aria-hidden size={14} />
                </Button>
            ) : null}
        </div>
    )
}
