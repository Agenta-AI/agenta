/**
 * LoadEvaluatorPresetModal
 *
 * Modal for selecting and applying evaluator setting presets.
 * Used in the new playground for evaluator configuration.
 */

import {memo, useMemo, useState} from "react"

import {type SettingsPreset} from "@agenta/entities/runnable"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Button, Divider, Input, Menu, Modal, Typography} from "antd"

// Re-export for consumers
export type {SettingsPreset}

export interface LoadEvaluatorPresetModalProps {
    /** Whether the modal is open */
    open: boolean
    /** Close handler */
    onCancel: () => void
    /** Available presets */
    presets: SettingsPreset[]
    /** Callback when a preset is applied */
    onApply: (preset: SettingsPreset) => void
}

/**
 * Modal for loading evaluator setting presets.
 *
 * Displays a searchable list of presets on the left and
 * a JSON preview of the selected preset values on the right.
 */
export const LoadEvaluatorPresetModal = memo(function LoadEvaluatorPresetModal({
    open,
    onCancel,
    presets,
    onApply,
}: LoadEvaluatorPresetModalProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedName, setSelectedName] = useState<string>("")

    // Reset selection when modal opens
    const [prevOpen, setPrevOpen] = useState(open)
    if (open !== prevOpen) {
        setPrevOpen(open)
        if (open) {
            setSelectedName(presets[0]?.name || "")
            setSearchTerm("")
        }
    }

    // Filter presets by search term
    const filteredPresets = useMemo(() => {
        if (!searchTerm) return presets
        return presets.filter((preset) =>
            preset.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, presets])

    // Get selected preset
    const selectedPreset = useMemo(
        () => presets.find((p) => p.name === selectedName) ?? null,
        [selectedName, presets],
    )

    // Handle apply
    const handleApply = () => {
        if (!selectedPreset) return
        onApply(selectedPreset)
        onCancel()
    }

    return (
        <Modal
            title="Load Preset"
            open={open}
            onCancel={onCancel}
            width={900}
            footer={
                <div className="flex justify-end gap-2">
                    <Button onClick={onCancel}>Cancel</Button>
                    <Button type="primary" disabled={!selectedPreset} onClick={handleApply}>
                        Load Preset
                    </Button>
                </div>
            }
            styles={{
                body: {height: 500, overflow: "hidden"},
            }}
        >
            <div className="flex gap-4 h-full mt-4">
                {/* Left side - Preset list */}
                <div className="flex flex-col gap-3 w-[200px] flex-shrink-0">
                    <Input.Search
                        placeholder="Search presets..."
                        allowClear
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />

                    <Divider className="m-0" />

                    <Menu
                        items={filteredPresets.map((preset) => ({
                            key: preset.name,
                            label: preset.name,
                        }))}
                        onSelect={({key}) => setSelectedName(key)}
                        selectedKeys={selectedName ? [selectedName] : []}
                        className="h-[380px] overflow-y-auto !border-none"
                    />
                </div>

                <Divider type="vertical" className="m-0 h-full" />

                {/* Right side - Preset preview */}
                <div className="flex flex-col gap-3 flex-1 min-w-0 overflow-hidden">
                    <Typography.Text className="text-base font-medium">
                        {selectedPreset?.name || "Select a preset"}
                    </Typography.Text>

                    <div className="flex-1 overflow-auto">
                        <SharedEditor
                            readOnly
                            disabled
                            state="disabled"
                            editorType="border"
                            initialValue={
                                selectedPreset?.settings_values
                                    ? JSON.stringify(selectedPreset.settings_values, null, 2)
                                    : "{}"
                            }
                            editorProps={{
                                codeOnly: true,
                                language: "json",
                                showLineNumbers: false,
                            }}
                            syncWithInitialValueChanges={true}
                            className="min-h-[380px]"
                        />
                    </div>
                </div>
            </div>
        </Modal>
    )
})

export default LoadEvaluatorPresetModal
