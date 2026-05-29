import {ReactNode} from "react"

import {Check} from "@phosphor-icons/react"
import {Divider, Switch, Typography} from "antd"
import clsx from "clsx"

import {SPAN_VISIBILITY_OPTIONS, SpanVisibilityMode} from "../TraceTree/assets/spanVisibility"

import {TraceTreeSettingsProps} from "./types"

const DISPLAY_TOGGLES = [
    {key: "latency", label: "Show latency"},
    {key: "cost", label: "Show cost"},
    {key: "tokens", label: "Show tokens"},
] as const

const SectionLabel = ({children}: {children: ReactNode}) => (
    <Typography.Text className="block px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-colorTextTertiary">
        {children}
    </Typography.Text>
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
                    <Typography.Text>{label}</Typography.Text>
                    <Switch
                        size="small"
                        checked={settings[key]}
                        onChange={(checked) => handleSwitchChange(key, checked)}
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
                            className="flex items-center justify-between gap-3 px-3 py-1.5 cursor-pointer rounded-sm hover:bg-colorBgTextHover"
                            onClick={() => setVisibility(option.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault()
                                    setVisibility(option.value)
                                }
                            }}
                        >
                            <div className="flex flex-col min-w-0">
                                <Typography.Text>{option.label}</Typography.Text>
                                <Typography.Text className="text-[11px] leading-tight text-colorTextTertiary">
                                    {option.hint}
                                </Typography.Text>
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
