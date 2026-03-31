import React from "react"

import {Switch, Typography} from "antd"
import clsx from "clsx"

import {TraceTreeSettingsProps} from "./types"

const TraceTreeSettings = ({settings, setSettings}: TraceTreeSettingsProps) => {
    const handleSwitchChange = (key: keyof typeof settings, checked: boolean) => {
        setSettings((prev) => ({
            ...prev,
            [key]: checked,
        }))
    }

    return (
        <div>
            <div className="py-2">
                <Typography.Text className="font-medium">Settings</Typography.Text>
            </div>

            <div
                className={clsx(
                    "flex flex-col gap-2 py-2 border-0 border-t border-solid border-colorSplit",
                )}
            >
                <div className="flex justify-between items-center gap-2">
                    <Typography.Text>Show Latency</Typography.Text>
                    <Switch
                        checked={settings.latency}
                        onChange={(checked) => handleSwitchChange("latency", checked)}
                    />
                </div>
                <div className="flex justify-between items-center gap-2">
                    <Typography.Text>Show Cost</Typography.Text>
                    <Switch
                        checked={settings.cost}
                        onChange={(checked) => handleSwitchChange("cost", checked)}
                    />
                </div>
                <div className="flex justify-between items-center gap-2">
                    <Typography.Text>Show Tokens</Typography.Text>
                    <Switch
                        checked={settings.tokens}
                        onChange={(checked) => handleSwitchChange("tokens", checked)}
                    />
                </div>
            </div>
        </div>
    )
}

export default TraceTreeSettings
