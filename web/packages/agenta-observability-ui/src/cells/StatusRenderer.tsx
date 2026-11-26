import type {StatusCode} from "@agenta/entities/trace"
import {useT} from "@agenta/i18n"
import cellsCatalog from "@agenta/i18n/catalogs/observabilityUi.cells"
import {CheckCircleIcon, InfoIcon, XCircleIcon} from "@phosphor-icons/react"

import {Chip, type ChipTone} from "../primitives/Chip"

export const statusMapper = (status: StatusCode) => {
    switch (status) {
        case "STATUS_CODE_ERROR":
            return {
                label: "failure",
                tone: "error" as ChipTone,
                icon: <XCircleIcon size={12} />,
            }
        default:
            return {
                label: "success",
                tone: "success" as ChipTone,
                icon: <CheckCircleIcon size={12} />,
            }
    }
}

interface Props {
    status?: StatusCode | null
    message?: string | null
    showMore?: boolean
    /** antd's `tagProps={{bordered: false}}` equivalent. */
    bordered?: boolean
    className?: string
}

export const StatusRenderer = ({
    status,
    message,
    showMore = false,
    bordered = true,
    className,
}: Props) => {
    const t = useT(cellsCatalog)
    const {label, tone, icon} = statusMapper(status || "STATUS_CODE_UNSET")
    // `label` is the stored word ("failure"); only the chip shows it in the active language.
    const errorMsg = status === "STATUS_CODE_ERROR" ? message : null

    return (
        <span className="inline-flex items-center gap-2">
            <Chip
                tone={tone}
                icon={icon}
                className={`font-mono ${bordered ? "" : "border-transparent"} ${className ?? ""}`}
            >
                {label === "failure"
                    ? t("observabilityUi.cells.statusFailure")
                    : t("observabilityUi.cells.statusSuccess")}
            </Chip>
            {showMore && errorMsg ? (
                <span title={errorMsg} className="inline-grid place-items-center">
                    <InfoIcon size={14} />
                </span>
            ) : null}
        </span>
    )
}

export default StatusRenderer
