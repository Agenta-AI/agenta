import {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {SPAN_VISIBILITY_OPTIONS, type SpanVisibilityMode} from "@agenta/observability"
import {Divider, Switch} from "@agenta/ui/ui"
import {Check} from "@phosphor-icons/react"
import clsx from "clsx"

import type {TraceTreeSettingsProps} from "./traceTreeSettingsTypes"

const DISPLAY_TOGGLES = [
    {key: "latency", label: "observabilityUi.traceDrawer.showLatency"},
    {key: "cost", label: "observabilityUi.traceDrawer.showCost"},
    {key: "tokens", label: "observabilityUi.traceDrawer.showTokens"},
] as const

const VISIBILITY_KEYS = {
    all: {
        label: "observabilityUi.traceDrawer.visibilityAll",
        hint: "observabilityUi.traceDrawer.visibilityAllHint",
    },
    key: {
        label: "observabilityUi.traceDrawer.visibilityKey",
        hint: "observabilityUi.traceDrawer.visibilityKeyHint",
    },
} as const

const SectionLabel = ({children}: {children: ReactNode}) => (
    <span className="block px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wider text-colorTextTertiary">
        {children}
    </span>
)

const TraceTreeSettings = ({
    settings,
    setSettings,
    showVisibility = false,
}: TraceTreeSettingsProps) => {
    const t = useT(drawerCatalog)
    const handleSwitchChange = (key: (typeof DISPLAY_TOGGLES)[number]["key"], checked: boolean) => {
        setSettings((prev) => ({...prev, [key]: checked}))
    }

    const visibility = settings.visibility ?? "key"
    const setVisibility = (mode: SpanVisibilityMode) => {
        setSettings((prev) => ({...prev, visibility: mode}))
    }

    return (
        <div className="flex flex-col py-1">
            <SectionLabel>{t("observabilityUi.traceDrawer.display")}</SectionLabel>
            {DISPLAY_TOGGLES.map(({key, label}) => (
                <div key={key} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span>{t(label)}</span>
                    <Switch
                        size="sm"
                        checked={settings[key]}
                        onCheckedChange={(checked) => handleSwitchChange(key, checked)}
                    />
                </div>
            ))}

            {showVisibility && (
                <>
                    <Divider className="my-1" />
                    <SectionLabel>{t("observabilityUi.traceDrawer.visibility")}</SectionLabel>
                    {SPAN_VISIBILITY_OPTIONS.map((option) => (
                        <div
                            key={option.value}
                            role="menuitemradio"
                            aria-checked={visibility === option.value}
                            tabIndex={0}
                            className="flex items-center justify-between gap-3 px-3 py-1.5 cursor-pointer rounded-sm hover:bg-colorFillSecondary"
                            onClick={() => setVisibility(option.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault()
                                    setVisibility(option.value)
                                }
                            }}
                        >
                            <div className="flex flex-col min-w-0">
                                <span>
                                    {option.value in VISIBILITY_KEYS
                                        ? t(VISIBILITY_KEYS[option.value].label)
                                        : option.label}
                                </span>
                                <span className="text-xs leading-tight text-colorTextTertiary">
                                    {option.value in VISIBILITY_KEYS
                                        ? t(VISIBILITY_KEYS[option.value].hint)
                                        : option.hint}
                                </span>
                            </div>
                            <Check
                                size={14}
                                weight="bold"
                                className={clsx("shrink-0 text-colorPrimary", {
                                    invisible: visibility !== option.value,
                                })}
                            />
                        </div>
                    ))}
                </>
            )}
        </div>
    )
}

export default TraceTreeSettings
