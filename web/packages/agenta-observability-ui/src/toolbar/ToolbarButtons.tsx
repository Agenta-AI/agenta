import {useT} from "@agenta/i18n"
import toolbarCatalog from "@agenta/i18n/catalogs/observabilityUi.toolbar"
import {selectedRowKeysAtom} from "@agenta/observability"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowsClockwiseIcon, ExportIcon, TrashIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {hasTracesAtom} from "./state"

type ButtonSize = "sm" | "default"

export interface RefreshButtonProps {
    isLoading?: boolean
    onClick: () => void
}

export const RefreshButton = ({isLoading, onClick}: RefreshButtonProps) => {
    const t = useT(toolbarCatalog)
    return (
        <SimpleTooltip title={t("observabilityUi.toolbar.refreshData")}>
            <Button
                variant="outline"
                size="icon"
                aria-label={t("observabilityUi.toolbar.refreshData")}
                onClick={onClick}
            >
                <ArrowsClockwiseIcon
                    size={14}
                    className={clsx("mt-px", {"animate-spin": isLoading})}
                />
            </Button>
        </SimpleTooltip>
    )
}

export interface ExportButtonProps {
    /** While exporting the button becomes the cancel affordance for the running scan. */
    isExporting?: boolean
    onClick: () => void
    size?: ButtonSize
}

export const ExportButton = ({isExporting, onClick, size = "default"}: ExportButtonProps) => {
    const t = useT(toolbarCatalog)
    const hasTraces = useAtomValue(hasTracesAtom)

    return (
        <Button
            variant="ghost"
            size={size}
            aria-label={
                isExporting
                    ? t("observabilityUi.toolbar.cancelExport")
                    : t("observabilityUi.toolbar.exportTraces")
            }
            onClick={onClick}
            disabled={!isExporting && !hasTraces}
        >
            <ExportIcon size={14} />
            {isExporting
                ? t("observabilityUi.toolbar.cancelExport")
                : t("observabilityUi.toolbar.export")}
        </Button>
    )
}

export interface DeleteTracesButtonProps {
    onClick: () => void
    size?: ButtonSize
}

export const DeleteTracesButton = ({onClick, size = "default"}: DeleteTracesButtonProps) => {
    const t = useT(toolbarCatalog)
    const selectedRowKeys = useAtomValue(selectedRowKeysAtom)
    const disabled = selectedRowKeys.length === 0

    return (
        // A disabled button swallows pointer events, so the hint hangs off the wrapper.
        <SimpleTooltip title={disabled ? t("observabilityUi.toolbar.selectToDelete") : undefined}>
            <span className="inline-flex">
                <Button
                    variant="destructive-ghost"
                    size={size}
                    aria-label={t("observabilityUi.toolbar.deleteSelected")}
                    onClick={onClick}
                    disabled={disabled}
                >
                    <TrashIcon size={14} />
                    {t("observabilityUi.toolbar.delete")}
                </Button>
            </span>
        </SimpleTooltip>
    )
}
