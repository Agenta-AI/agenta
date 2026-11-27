import {useState} from "react"

import {useT} from "@agenta/i18n"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import {Button} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {ArrowsIn, ArrowsOut, Check, ClipboardText} from "@phosphor-icons/react"

/**
 * The drawer's tools beside its title: full screen (on a wide screen; a phone already shows the
 * drawer full screen) and copy the whole test case as JSON. Close is the sheet header's own.
 */
export const ScenarioFocusToolbar = ({
    fullScreen,
    onFullScreen,
    payload,
}: {
    fullScreen: boolean
    onFullScreen: (next: boolean) => void
    /** The test case as JSON text, which the copy button copies. */
    payload: string
}) => {
    const t = useT(focusCatalog)
    const [copied, setCopied] = useState<string | null>(null)
    const fullScreenLabel = t(
        fullScreen
            ? "evaluations.scenarioFocus.exitFullScreen"
            : "evaluations.scenarioFocus.fullScreen",
    )

    return (
        <div className="flex shrink-0 items-center gap-1">
            <Button
                variant="ghost"
                size="icon-sm"
                className="max-lg:hidden"
                aria-label={fullScreenLabel}
                title={fullScreenLabel}
                onClick={() => onFullScreen(!fullScreen)}
            >
                {fullScreen ? <ArrowsIn /> : <ArrowsOut />}
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("evaluations.scenarioFocus.copyAsJson")}
                title={t("evaluations.scenarioFocus.copyAsJson")}
                onClick={async () => {
                    if (await copyToClipboard(payload)) setCopied(payload)
                }}
            >
                {copied === payload ? <Check /> : <ClipboardText />}
            </Button>
        </div>
    )
}
