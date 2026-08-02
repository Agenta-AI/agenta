/**
 * PresetContent
 *
 * Content component for the LoadEvaluatorPresetModal.
 * Shows a searchable list of presets on the left and a YAML/JSON preview on the right.
 */

import {memo, useState, useMemo} from "react"

import {SharedEditor} from "@agenta/ui/shared-editor"
import {cn} from "@agenta/ui/styles"
import {Divider, SearchInput, Segmented} from "@agenta/ui/ui"
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
                <SearchInput
                    placeholder="Search"
                    allowClear
                    onValueChange={(v) => setSearchTerm(v)}
                />

                <Divider className="m-0" />

                {/* Was antd Menu (no @agenta/ui counterpart): a plain selectable list. */}
                <div role="listbox" aria-label="Presets" className="h-[500px] overflow-y-auto">
                    {filteredPresets.map((preset) => {
                        const selected = preset.key === selectedPresetKey
                        return (
                            <button
                                key={preset.key}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onClick={() => onSelectPreset(String(preset.key))}
                                className={cn(
                                    "box-border flex w-full cursor-pointer items-center border-0 rounded-control-sm px-3 py-0 h-control text-left text-xs transition-colors",
                                    selected
                                        ? "bg-controlItemBgActive text-primary"
                                        : "bg-transparent text-colorText hover:bg-muted",
                                )}
                            >
                                <span className="min-w-0 truncate">{preset.name}</span>
                            </button>
                        )
                    })}
                </div>
            </div>

            <Divider type="vertical" className="m-0 h-full" />

            {/* Right content - preview */}
            <div className="flex flex-col gap-4 flex-1 h-full overflow-y-auto">
                <div className="flex items-start justify-between gap-4 sticky top-0 z-10 bg-[var(--ag-c-FFFFFF)]">
                    <span className="text-lg font-medium -mt-1 text-colorText">
                        Select a Preset
                    </span>
                    {/* Was antd Radio.Button pair — Radio.Button maps to Segmented (Radio.md). */}
                    <Segmented
                        size="sm"
                        value={format}
                        onChange={(v) => setFormat(v as "yaml" | "json")}
                        options={[
                            {label: "YAML", value: "yaml"},
                            {label: "JSON", value: "json"},
                        ]}
                    />
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
                            ariaLabel: "Preset preview",
                        }}
                        syncWithInitialValueChanges={true}
                    />
                </div>
            </div>
        </section>
    )
})

export default PresetContent
