import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsAccessCatalog from "@agenta/i18n/catalogs/settings.access"
import {FieldHelp, Spinner, Switch} from "@agenta/ui/ui"
import {CheckCircle, Lock} from "@phosphor-icons/react"

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

/** One switchable policy row inside a `SettingsSection`. */
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
}: SettingToggleRowProps) => {
    const t = useT(commonCatalog, settingsAccessCatalog)
    return (
        <div
            className={`flex items-center justify-between gap-6 px-4 py-4 ${disabled ? "opacity-60" : ""}`}
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{title}</span>
                    {tooltip ? (
                        <FieldHelp label={t("settings.access.aboutSetting", {title})}>
                            {tooltip}
                        </FieldHelp>
                    ) : null}
                    {showSuccess ? (
                        <span className="inline-flex items-center gap-1 text-meta text-success">
                            <CheckCircle size={14} />
                            {t("common.saved")}
                        </span>
                    ) : null}
                    {/* antd's Switch drew its own loading spinner; the Radix one does not. */}
                    {loading ? <Spinner size="small" aria-label={t("common.saving")} /> : null}
                </div>
                <p className="m-0 mt-0.5 text-label text-muted-foreground">{description}</p>
                {disabled && disabledReason ? (
                    <p className="m-0 mt-1 flex items-center gap-1 text-meta text-warning">
                        <Lock size={14} />
                        {disabledReason}
                    </p>
                ) : null}
            </div>
            <Switch checked={enabled} onCheckedChange={onChange} disabled={disabled || loading} />
        </div>
    )
}
