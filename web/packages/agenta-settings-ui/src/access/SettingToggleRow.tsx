import type {ReactNode} from "react"

import {
    Spinner,
    Switch,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {CheckCircle, Info, Lock} from "@phosphor-icons/react"

export interface SettingToggleRowProps {
    title: string
    description: ReactNode
    enabled: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
    /** Shown under the row with a lock — say why it is off, not just that it is. */
    disabledReason?: string
    tooltip?: string
    loading?: boolean
    showSuccess?: boolean
}

/** One switchable policy: what it does, whether you may change it, and whether it just saved. */
export const SettingToggleRow = ({
    title,
    description,
    enabled,
    onChange,
    disabled,
    disabledReason,
    tooltip,
    loading,
    showSuccess,
}: SettingToggleRowProps) => (
    <div
        className={`flex items-start justify-between border-0 border-b border-solid border-colorBorderSecondary py-4 last:border-0 ${
            disabled ? "opacity-60" : ""
        }`}
    >
        <div className="flex-1 pr-8">
            <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-colorText">{title}</span>
                {/* Its own provider, like every other tooltip in this package: a host without
                    a global one (the mobile app) would otherwise throw on render. */}
                {tooltip ? (
                    <TooltipProvider>
                        <Tooltip>
                            {/* A button, not a span: the tooltip carries the only explanation of
                                what the toggle does, and a span cannot be reached by keyboard, so
                                that explanation was mouse-only. */}
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={`About ${title}`}
                                    className="flex cursor-help items-center border-0 bg-transparent p-0 text-colorTextTertiary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
                                >
                                    <Info size={16} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>{tooltip}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : null}
                {showSuccess ? (
                    <span className="inline-flex items-center gap-1 text-xs text-colorSuccess">
                        <CheckCircle size={14} />
                        Saved
                    </span>
                ) : null}
                {/* antd's Switch drew its own loading spinner; the Radix one does not. */}
                {loading ? <Spinner size="small" aria-label="Saving" /> : null}
            </div>
            <p className="m-0 mt-0.5 text-xs text-colorTextSecondary">{description}</p>
            {disabled && disabledReason ? (
                <p className="m-0 mt-1 flex items-center gap-1 text-xs text-colorWarning">
                    <Lock size={14} />
                    {disabledReason}
                </p>
            ) : null}
        </div>
        <Switch checked={enabled} onCheckedChange={onChange} disabled={disabled || loading} />
    </div>
)
