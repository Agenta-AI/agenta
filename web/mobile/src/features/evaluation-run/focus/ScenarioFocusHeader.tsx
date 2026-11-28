import type {ComponentProps, ReactNode} from "react"

import {useT} from "@agenta/i18n"
import obsAnnotateCatalog from "@agenta/i18n/catalogs/observability.annotate"
import {Button, SheetHeader, SheetTitle} from "@agenta/ui/ui"
import {PencilSimpleIcon} from "@phosphor-icons/react"

import {CompareRowRun} from "../compare/scenarios/CompareRowRun"

import {ScenarioFocusToolbar} from "./ScenarioFocusToolbar"
import {ScenarioNavigator} from "./ScenarioNavigator"
import {scenarioNoun} from "./scenarioNoun"

/**
 * The drawer's title with its link and tools, while comparing the run it shows, the summary line
 * of the test case, and the navigator. "Annotate" opens the Annotate panel beside the drawer.
 */
export const ScenarioFocusHeader = ({
    toolbar,
    compareRun = null,
    link,
    summary,
    annotate = null,
    ...props
}: ComponentProps<typeof ScenarioNavigator> & {
    toolbar: ComponentProps<typeof ScenarioFocusToolbar>
    compareRun?: {slot: number; name: string} | null
    /** "Open in test set", when the run has one. */
    link: ReactNode
    /** The passed count, duration, tokens and cost. */
    summary: ReactNode
    /** The Annotate button; null without the `edit_annotations` permission. */
    annotate?: {open: boolean; onToggle: () => void} | null
}) => {
    const t = useT(obsAnnotateCatalog)
    return (
        <SheetHeader className="pb-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <SheetTitle>
                    {scenarioNoun(props.kind)} #{props.current.index}
                </SheetTitle>
                <div className="flex shrink-0 items-center gap-1">
                    {annotate ? (
                        <Button
                            variant="outline"
                            size="sm"
                            aria-pressed={annotate.open}
                            className="aria-pressed:bg-selected"
                            onClick={annotate.onToggle}
                        >
                            <PencilSimpleIcon aria-hidden />
                            {t("observability.annotate.annotate")}
                        </Button>
                    ) : null}
                    {link}
                    <ScenarioFocusToolbar {...toolbar} />
                </div>
            </div>
            {compareRun ? <CompareRowRun slot={compareRun.slot} name={compareRun.name} /> : null}
            {summary}
            <div className="pt-3">
                <ScenarioNavigator {...props} />
            </div>
        </SheetHeader>
    )
}
