import type {ClientToolWidgetProps} from "@agenta/shared/clientTools"
import {Key} from "@phosphor-icons/react"

export const SecretRequestWidget = ({meta}: ClientToolWidgetProps) => {
    const input = meta.input as {name?: string} | undefined
    const output = meta.output as {status?: string; env_var?: string} | undefined
    const label = meta.settled
        ? output?.status === "configured"
            ? `${output.env_var ?? "Secret"} attached`
            : "Secret not configured"
        : `Set up ${input?.name ?? "secret"} below`
    return (
        <div className="flex items-center gap-2 py-1 text-xs text-colorTextSecondary">
            <Key size={14} />
            <span>{label}</span>
        </div>
    )
}
