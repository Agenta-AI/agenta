import {ReactNode} from "react"

import {SPAN_VISIBILITY_OPTIONS, type SpanVisibilityMode} from "@agenta/observability"
import {Divider, Switch} from "@agenta/ui/ui"
import {Check} from "@phosphor-icons/react"
import clsx from "clsx"

import type {TraceTreeSettingsProps} from "./traceTreeSettingsTypes"

const DISPLAY_TOGGLES = [
    {key: "latency", label: "Show latency"},
    {key: "cost", label: "Show cost"},
    {key: "tokens", label: "Show tokens"},
] as const

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
    const handleSwitchChange = (key: (typeof DISPLAY_TOGGLES)[number]["key"], checked: boolean) => {
        setSettings((prev) => ({...prev, [key]: checked}))
    }

    const visibility = settings.visibility ?? "key"
    const setVisibility = (mode: SpanVisibilityMode) => {
        setSettings((prev) => ({...prev, visibility: mode}))
    }

    return (
        <div className="flex flex-col py-1">
            <SectionLabel>Display</SectionLabel>
            {DISPLAY_TOGGLES.map(({key, label}) => (
                <div key={key} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span>{label}</span>
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
                    <SectionLabel>Visibility</SectionLabel>
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
                                <span>{option.label}</span>
                                <span className="text-xs leading-tight text-colorTextTertiary">
                                    {option.hint}
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
