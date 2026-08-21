import type {StatusCode} from "@agenta/entities/trace"
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
    const {label, tone, icon} = statusMapper(status || "STATUS_CODE_UNSET")
    const errorMsg = status === "STATUS_CODE_ERROR" ? message : null

    return (
        <span className="inline-flex items-center gap-2">
            <Chip
                tone={tone}
                icon={icon}
                className={`font-mono ${bordered ? "" : "border-transparent"} ${className ?? ""}`}
            >
                {label}
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
