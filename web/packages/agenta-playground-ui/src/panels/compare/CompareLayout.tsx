import {useCallback, useRef, useState, type ReactNode} from "react"

import {executionController} from "@agenta/playground"
import {useMediaQuery} from "@agenta/ui/hooks"
import {cn, Segmented} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {usePlaygroundScrollSync} from "../../hooks/usePlaygroundScrollSync"
import {RunsPanelHeader} from "../runs/RunsPanelHeader"

import {LEAD_COLUMN, REVISION_COLUMN} from "./columns"
import {CompareRuns} from "./CompareRuns"
import {VariantColumn} from "./VariantColumn"

type Area = "config" | "runs"

const AREAS: {value: Area; label: string}[] = [
    {value: "config", label: "Configuration"},
    {value: "runs", label: "Generations"},
]

export interface CompareLayoutProps {
    /** The revisions on screen, in column order. */
    revisionIds: string[]
    /** One revision's config column: its bar and its editor. */
    renderConfig: (revisionId: string) => ReactNode
    /** The reader closed a revision. The host asks first when it has unsaved edits. */
    onClose: (revisionId: string) => void
    /** The line under each output with the run's numbers and the trace link. */
    renderTraceFooter?: (traceId: string) => ReactNode
}

/**
 * The playground with two or more revisions side by side. The config area (variants, then one
 * config column per revision) sits above the run area (inputs, then one output column per
 * revision). Both areas scroll sideways together, so each output stays under its config. Below
 * `md` one area shows at a time, picked with a Configuration / Generations switch, and the
 * columns stack, so only the page scrolls, and only up and down.
 */
export const CompareLayout = ({
    revisionIds,
    renderConfig,
    onClose,
    renderTraceFooter,
}: CompareLayoutProps) => {
    const twoAreas = useMediaQuery("(min-width: 768px)")
    const [area, setArea] = useState<Area>("config")
    const {setConfigPanelRef, setGenerationPanelRef} = usePlaygroundScrollSync({
        enabled: twoAreas,
    })
    const isChat = useAtomValue(executionController.selectors.isChatMode)
    const configAreaRef = useRef<HTMLDivElement | null>(null)

    const show = useCallback((revisionId: string) => {
        configAreaRef.current
            ?.querySelector(`[data-compare-column="${revisionId}"]`)
            ?.scrollIntoView({behavior: "smooth", block: "nearest", inline: "nearest"})
    }, [])
    const setConfigArea = useCallback(
        (element: HTMLDivElement | null) => {
            configAreaRef.current = element
            setConfigPanelRef(element)
        },
        [setConfigPanelRef],
    )

    const showConfig = twoAreas || area === "config"
    const showRuns = twoAreas || area === "runs"

    return (
        <div data-testid="compare-layout" className="flex min-h-0 flex-1 flex-col">
            {twoAreas ? null : (
                <div className="shrink-0 border-b border-border px-4 py-2">
                    <Segmented
                        block
                        size="sm"
                        options={AREAS}
                        value={area}
                        onChange={(value) => setArea(value as Area)}
                    />
                </div>
            )}
            <div
                ref={setConfigArea}
                className={cn(
                    "min-h-0 overflow-y-auto md:overflow-x-auto md:overflow-y-hidden",
                    twoAreas ? "basis-1/2 border-b border-border" : "flex-1",
                    !showConfig && "hidden",
                )}
            >
                <div className="flex flex-col md:h-full md:min-w-fit md:flex-row">
                    <div className={cn(LEAD_COLUMN, "md:h-full md:overflow-y-auto")}>
                        <VariantColumn revisionIds={revisionIds} onClose={onClose} onShow={show} />
                    </div>
                    {revisionIds.map((revisionId) => (
                        <div
                            key={revisionId}
                            data-testid={`compare-config-${revisionId}`}
                            data-compare-column={revisionId}
                            className={cn(REVISION_COLUMN, "md:h-full md:overflow-y-auto")}
                        >
                            {renderConfig(revisionId)}
                        </div>
                    ))}
                </div>
            </div>
            <div className={cn("flex min-h-0 flex-1 flex-col", !showRuns && "hidden")}>
                <RunsPanelHeader label={isChat ? "Chat" : "Generations"} />
                <div ref={setGenerationPanelRef} className="min-h-0 flex-1 overflow-auto">
                    <CompareRuns revisionIds={revisionIds} renderTraceFooter={renderTraceFooter} />
                </div>
            </div>
        </div>
    )
}
