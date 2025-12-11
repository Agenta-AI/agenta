import React from "react"

import {Flex, Switch, Typography} from "antd"
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
            <div className="px-4 py-2">
                <Typography.Text className="font-medium">Settings</Typography.Text>
            </div>

            <div
                className={clsx(
                    "flex flex-col gap-3 px-4 py-2 border-0 border-t border-solid border-colorSplit",
                )}
            >
                <Flex justify="space-between" align="center">
                    <Typography.Text>Show Latency</Typography.Text>
                    <Switch
                        checked={settings.latency}
                        onChange={(checked) => handleSwitchChange("latency", checked)}
                    />
                </Flex>
                <Flex justify="space-between" align="center">
                    <Typography.Text>Show Cost</Typography.Text>
                    <Switch
                        checked={settings.cost}
                        onChange={(checked) => handleSwitchChange("cost", checked)}
                    />
                </Flex>
                <Flex justify="space-between" align="center">
                    <Typography.Text>Show Tokens</Typography.Text>
                    <Switch
                        checked={settings.tokens}
                        onChange={(checked) => handleSwitchChange("tokens", checked)}
                    />
                </Flex>
            </div>
        </div>
    )
}

export default TraceTreeSettings
