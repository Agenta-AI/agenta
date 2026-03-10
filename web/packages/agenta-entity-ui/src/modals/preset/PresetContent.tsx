/**
 * PresetContent
 *
 * Content component for the LoadEvaluatorPresetModal.
 * Shows a searchable list of presets on the left and a YAML/JSON preview on the right.
 */

import {memo, useState, useMemo} from "react"

import {SharedEditor} from "@agenta/ui/shared-editor"
import {Divider, Input, Menu, Radio, Typography} from "antd"
import yaml from "js-yaml"

import type {PresetContentProps} from "./types"

export const PresetContent = memo(function PresetContent({
    presets,
    selectedPresetKey,
    onSelectPreset,
    selectedPreset,
}: PresetContentProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [format, setFormat] = useState<"yaml" | "json">("yaml")

    const filteredPresets = useMemo(() => {
        if (!searchTerm) return presets
        return presets.filter((preset) =>
            preset.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [presets, searchTerm])

    const presetPreview = useMemo(() => {
        if (!selectedPreset) return ""
        if (typeof selectedPreset.values === "string") return selectedPreset.values
        return format === "json"
            ? JSON.stringify(selectedPreset.values, null, 2)
            : yaml.dump(selectedPreset.values, {indent: 2})
    }, [selectedPreset, format])

    return (
        <section className="flex gap-4 flex-1 mt-4 overflow-y-auto h-full">
            {/* Left sidebar - preset list */}
            <div className="flex flex-col gap-4 w-[200px]">
                <Input.Search
                    placeholder="Search"
                    allowClear
                    onChange={(e) => setSearchTerm(e.target.value)}
                />

                <Divider className="m-0" />

                <Menu
                    items={filteredPresets.map((preset) => ({
                        key: preset.key,
                        label: preset.name,
                    }))}
                    onClick={({key}) => onSelectPreset(String(key))}
                    selectedKeys={selectedPresetKey ? [selectedPresetKey] : []}
                    className="h-[500px] overflow-y-auto !border-none"
                />
            </div>

            <Divider orientation="vertical" className="m-0 h-full" />

            {/* Right content - preview */}
            <div className="flex flex-col gap-4 flex-1 h-full overflow-y-auto">
                <div className="flex items-start justify-between gap-4 sticky top-0 z-10 bg-white">
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
})

export default PresetContent
