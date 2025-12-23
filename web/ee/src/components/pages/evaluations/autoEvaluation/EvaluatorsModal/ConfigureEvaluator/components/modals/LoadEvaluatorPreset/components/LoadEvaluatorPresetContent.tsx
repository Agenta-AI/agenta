import React, {useState} from "react"

import {Menu, Divider, Typography, Input, Radio} from "antd"
import yaml from "js-yaml"

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
    const [format, setFormat] = useState<"yaml" | "json">("yaml")

    const filteredTestset = !searchTerm
        ? settingsPresets
        : settingsPresets.filter((preset: SettingsPreset) =>
              preset.name.toLowerCase().includes(searchTerm.toLowerCase()),
          )

    const activePreset = settingsPresets.find((preset) => preset.key === selectedPresetKey) ?? null

    const presetPreview = (() => {
        if (!activePreset) return ""
        if (typeof activePreset.values === "string") return activePreset.values
        return format === "json"
            ? JSON.stringify(activePreset.values, null, 2)
            : yaml.dump(activePreset.values, {indent: 2})
    })()

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
                    onClick={({key}) => setSelectedPresetKey(String(key))}
                    selectedKeys={selectedPresetKey ? [selectedPresetKey] : []}
                    className="h-[500px] overflow-y-auto !border-none"
                />
            </div>

            <Divider orientation="vertical" className="m-0 h-full" />

            <div className="flex flex-col gap-4 flex-1 h-full overflow-y-auto">
                <div className="flex items-start justify-between gap-4 sticky top-0 z-10">
                    <Typography.Text className="text-lg font-medium -mt-1">
                        Select a Preset
                    </Typography.Text>
                    <Radio.Group
                        value={format}
                        onChange={(e) => setFormat(e.target.value as "yaml" | "json")}
                        size="small"
                    >
                        <Radio.Button value="yaml">YAML</Radio.Button>
                        <Radio.Button value="json">JSON</Radio.Button>
                    </Radio.Group>
                </div>

                <div className="overflow-y-auto h-full">
                    <SharedEditor
                        readOnly
                        disabled
                        state="disabled"
                        editorType="border"
                        initialValue={presetPreview}
                        editorProps={{
                            codeOnly: true,
                            language: format,
                        }}
                        syncWithInitialValueChanges={true}
                    />
                </div>
            </div>
        </section>
    )
}

export default LoadEvaluatorPresetContent
