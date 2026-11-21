/**
 * RunButton Component
 *
 * A generic run/rerun/cancel/run-all action button with Play/X icons, built on the
 * `@agenta/ui` Button. One `mode` prop drives the icon, label, and variant.
 *
 * @example
 * ```tsx
 * import { RunButton } from '@agenta/ui'
 *
 * <RunButton onClick={handleRun} />
 * <RunButton mode="cancel" onClick={handleCancel} />
 * <RunButton mode="runAll" variant="primary" onClick={handleRunAll} />
 * ```
 */

import {memo, type MouseEvent} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import listControlsCatalog from "@agenta/i18n/catalogs/ui.listControls"
import {PlayIcon, XCircleIcon} from "@phosphor-icons/react"

import {Button, type ButtonProps} from "../../ui/button"

// ============================================================================
// TYPES
// ============================================================================

export type RunButtonMode = "run" | "rerun" | "cancel" | "runAll"

export interface RunButtonProps extends ButtonProps {
    /** Which run action this button represents — drives icon, label, and variant. */
    mode?: RunButtonMode
    /** Custom label — honored only in `mode="run"`; the other modes have fixed labels. */
    label?: string
    onTrackRun?: () => void
}

// ============================================================================
// COMPONENT
// ============================================================================

const MODE_LABEL_KEY = {
    run: "ui.listControls.run",
    rerun: "ui.listControls.rerun",
    cancel: "common.cancel",
    runAll: "ui.listControls.runAll",
} as const

const RunButton = memo(({mode = "run", label, onTrackRun, ...props}: RunButtonProps) => {
    const t = useT(listControlsCatalog, commonCatalog)
    const isCancel = mode === "cancel"
    const {onClick, ...restProps} = props

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
        if (!isCancel) {
            onTrackRun?.()
        }
        onClick?.(event)
    }

    return (
        <Button
            variant={isCancel ? "destructive-outline" : "outline"}
            className="self-start"
            size="sm"
            onClick={handleClick}
            {...restProps}
        >
            {isCancel ? <XCircleIcon size={14} /> : <PlayIcon size={14} />}
            {mode === "run" ? label || t(MODE_LABEL_KEY.run) : t(MODE_LABEL_KEY[mode])}
        </Button>
    )
})

RunButton.displayName = "RunButton"

export default RunButton
