import {useT} from "@agenta/i18n"
import toolbarCatalog from "@agenta/i18n/catalogs/observabilityUi.toolbar"
import {selectedRowKeysAtom} from "@agenta/observability"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {SimpleTooltip} from "@agenta/ui/ui"
import {ArrowsClockwiseIcon, ExportIcon, TrashIcon} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {hasTracesAtom} from "./state"

/** antd size names — `EnhancedButton` keeps the antd props surface. */
type ButtonSize = "small" | "middle"

export interface RefreshButtonProps {
    isLoading?: boolean
    onClick: () => void
}

export const RefreshButton = ({isLoading, onClick}: RefreshButtonProps) => {
    const t = useT(toolbarCatalog)
    return (
        <EnhancedButton
            aria-label={t("observabilityUi.toolbar.refreshData")}
            icon={
                <ArrowsClockwiseIcon
                    size={14}
                    className={clsx("mt-[0.8px]", {"animate-spin": isLoading})}
                />
            }
            onClick={onClick}
            tooltipProps={{title: t("observabilityUi.toolbar.refreshData")}}
        />
    )
}

export interface ExportButtonProps {
    /** While exporting the button becomes the cancel affordance for the running scan. */
    isExporting?: boolean
    onClick: () => void
    size?: ButtonSize
}

export const ExportButton = ({isExporting, onClick, size = "middle"}: ExportButtonProps) => {
    const t = useT(toolbarCatalog)
    const hasTraces = useAtomValue(hasTracesAtom)

    return (
        <EnhancedButton
            type="text"
            size={size}
            aria-label={
                isExporting
                    ? t("observabilityUi.toolbar.cancelExport")
                    : t("observabilityUi.toolbar.exportTraces")
            }
            onClick={onClick}
            icon={<ExportIcon size={14} />}
            disabled={!isExporting && !hasTraces}
        >
            {isExporting
                ? t("observabilityUi.toolbar.cancelExport")
                : t("observabilityUi.toolbar.export")}
        </EnhancedButton>
    )
}

export interface DeleteTracesButtonProps {
    onClick: () => void
    size?: ButtonSize
}

export const DeleteTracesButton = ({onClick, size = "middle"}: DeleteTracesButtonProps) => {
    const t = useT(toolbarCatalog)
    const selectedRowKeys = useAtomValue(selectedRowKeysAtom)
    const disabled = selectedRowKeys.length === 0

    return (
        // A disabled button swallows pointer events, so the hint hangs off the wrapper.
        <SimpleTooltip title={disabled ? t("observabilityUi.toolbar.selectToDelete") : undefined}>
            <span className="inline-flex">
                <EnhancedButton
                    type="text"
                    size={size}
                    danger
                    aria-label={t("observabilityUi.toolbar.deleteSelected")}
                    onClick={onClick}
                    icon={<TrashIcon size={14} />}
                    disabled={disabled}
                >
                    {t("observabilityUi.toolbar.delete")}
                </EnhancedButton>
            </span>
        </SimpleTooltip>
    )
}
