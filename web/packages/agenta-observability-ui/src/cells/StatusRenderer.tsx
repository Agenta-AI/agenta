import type {StatusCode} from "@agenta/entities/trace"
import {useT} from "@agenta/i18n"
import cellsCatalog from "@agenta/i18n/catalogs/observabilityUi.cells"
import {Badge, type BadgeVariant, cn} from "@agenta/ui/ui"
import {CheckCircleIcon, InfoIcon, XCircleIcon} from "@phosphor-icons/react"

export const statusMapper = (status: StatusCode) => {
    switch (status) {
        case "STATUS_CODE_ERROR":
            return {
                label: "failure",
                variant: "destructive" as BadgeVariant,
                icon: <XCircleIcon size={12} />,
            }
        default:
            return {
                label: "success",
                variant: "success" as BadgeVariant,
                icon: <CheckCircleIcon size={12} />,
            }
    }
}

interface Props {
    status?: StatusCode | null
    message?: string | null
    showMore?: boolean
    className?: string
}

export const StatusRenderer = ({status, message, showMore = false, className}: Props) => {
    const t = useT(cellsCatalog)
    const {label, variant, icon} = statusMapper(status || "STATUS_CODE_UNSET")
    // `label` is the stored word ("failure"); only the chip shows it in the active language.
    const errorMsg = status === "STATUS_CODE_ERROR" ? message : null

    return (
        <span className="inline-flex items-center gap-2">
            <Badge variant={variant} icon={icon} className={cn("font-mono", className)}>
                {label === "failure"
                    ? t("observabilityUi.cells.statusFailure")
                    : t("observabilityUi.cells.statusSuccess")}
            </Badge>
            {showMore && errorMsg ? (
                <span title={errorMsg} className="inline-grid place-items-center">
                    <InfoIcon size={14} />
                </span>
            ) : null}
        </span>
    )
}

export default StatusRenderer
