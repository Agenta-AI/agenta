import React, {useMemo, useState} from "react"

import {Menu, Divider, Typography, Input} from "antd"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {SettingsPreset} from "@/oss/lib/Types"

import {LoadEvaluatorPresetContentProps} from "../assets/types"

const LoadEvaluatorPresetContent = ({
    settingsPresets,
    selectedPresetKey,
    setSelectedPresetKey,
    selectedPreset,
}: LoadEvaluatorPresetContentProps) => {
    const [searchTerm, setSearchTerm] = useState("")

    const filteredTestset = useMemo(() => {
        if (!searchTerm) return settingsPresets
        return settingsPresets.filter((item: SettingsPreset) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, settingsPresets])

    return (
        <section className="flex gap-4 flex-1 mt-4 overflow-y-auto h-full">
            <div className="flex flex-col gap-4 w-[200px]">
                <Input.Search
                    placeholder="Search"
                    allowClear
                    onChange={(e) => setSearchTerm(e.target.value)}
                />

                <Divider className="m-0" />

                <Menu
                    items={filteredTestset.map((preset) => ({
                        key: preset.key,
                        label: preset.name,
                    }))}
                    onSelect={({key}) => setSelectedPresetKey(key)}
                    defaultSelectedKeys={[selectedPresetKey]}
                    selectedKeys={[selectedPresetKey]}
                    className="h-[500px] overflow-y-auto !border-none"
                />
            </div>

            <Divider type="vertical" className="m-0 h-full" />

            <div className="flex flex-col gap-4 flex-1 h-full overflow-y-auto">
                <div className="flex items-start justify-between gap-4 sticky top-0 z-10">
                    <Typography.Text className="text-lg font-medium -mt-1">
                        Select a Preset
                    </Typography.Text>
                </div>

                <div className="overflow-y-auto h-full">
                    <SharedEditor
                        readOnly
                        disabled
                        state="disabled"
                        editorType="border"
                        initialValue={
                            typeof selectedPreset?.values === "string"
                                ? selectedPreset.values
                                : JSON.stringify(selectedPreset?.values ?? {}, null, 2)
                        }
                        editorProps={{
                            codeOnly: true,
                            language: "json",
                        }}
                        syncWithInitialValueChanges={true}
                    />
                </div>
            </div>
        </section>
    )
}

export default LoadEvaluatorPresetContent
