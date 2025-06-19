import React from "react"

import {Flex, Switch, Typography} from "antd"

import {useStyles} from "./assets/styles"
import {TraceTreeSettingsProps} from "./assets/types"
import clsx from "clsx"

const TraceTreeSettings = ({settings, setSettings}: TraceTreeSettingsProps) => {
    const classes = useStyles()

    const handleSwitchChange = (key: keyof typeof settings, checked: boolean) => {
        setSettings((prev) => ({
            ...prev,
            [key]: checked,
        }))
    }

    return (
        <div>
            <div className={classes.container}>
                <Typography.Text className={classes.title}>Settings</Typography.Text>
            </div>

            <div className={clsx("flex flex-col gap-4", classes.content)}>
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
