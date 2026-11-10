import {useState} from "react"

import {Button, Segmented} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {
    ArrowsIn,
    ArrowsInLineVertical,
    ArrowsOut,
    ArrowsOutLineVertical,
    Check,
    ClipboardText,
} from "@phosphor-icons/react"

export type ScenarioFocusFormat = "form" | "json"

const FORMATS = [
    {value: "form", label: "Form"},
    {value: "json", label: "JSON"},
]

/**
 * The drawer's tools, as the old app has them: full screen (on a wide screen; a phone already
 * shows the drawer full screen), fold every section (or unfold them all once one is folded), copy the scenario as JSON, and
 * the Form or JSON view.
 */
export const ScenarioFocusToolbar = ({
    fullScreen,
    onFullScreen,
    someCollapsed,
    onCollapseAll,
    payload,
    format,
    onFormat,
}: {
    fullScreen: boolean
    onFullScreen: (next: boolean) => void
    someCollapsed: boolean
    onCollapseAll: (collapse: boolean) => void
    /** The scenario as JSON text, which the copy button copies. */
    payload: string
    format: ScenarioFocusFormat
    onFormat: (next: ScenarioFocusFormat) => void
}) => {
    const [copied, setCopied] = useState<string | null>(null)

    return (
        <div className="flex shrink-0 items-center gap-1">
            <Button
                variant="ghost"
                size="icon-sm"
                className="max-lg:hidden"
                aria-label={fullScreen ? "Exit full screen" : "Full screen"}
                title={fullScreen ? "Exit full screen" : "Full screen"}
                onClick={() => onFullScreen(!fullScreen)}
            >
                {fullScreen ? <ArrowsIn /> : <ArrowsOut />}
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                disabled={format !== "form"}
                aria-label={someCollapsed ? "Expand all sections" : "Collapse all sections"}
                title={someCollapsed ? "Expand all sections" : "Collapse all sections"}
                onClick={() => onCollapseAll(!someCollapsed)}
            >
                {someCollapsed ? <ArrowsOutLineVertical /> : <ArrowsInLineVertical />}
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy as JSON"
                title="Copy as JSON"
                onClick={async () => {
                    if (await copyToClipboard(payload)) setCopied(payload)
                }}
            >
                {copied === payload ? <Check /> : <ClipboardText />}
            </Button>
            <Segmented
                size="sm"
                aria-label="View as"
                options={FORMATS}
                value={format}
                onChange={(next) => onFormat(next as ScenarioFocusFormat)}
            />
        </div>
    )
}
