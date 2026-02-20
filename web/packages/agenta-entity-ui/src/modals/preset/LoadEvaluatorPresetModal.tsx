/**
 * LoadEvaluatorPresetModal
 *
 * Modal for selecting and loading evaluator presets.
 * Shows a list of available presets with YAML/JSON preview.
 */

import {memo, useState, useMemo, useEffect} from "react"

import {Button, Modal} from "antd"
import clsx from "clsx"

import {PresetContent} from "./PresetContent"
import type {LoadEvaluatorPresetModalProps} from "./types"

export const LoadEvaluatorPresetModal = memo(function LoadEvaluatorPresetModal({
    presets,
    selectedPreset: initialSelectedPreset,
    onLoadPreset,
    open,
    onCancel,
    ...modalProps
}: LoadEvaluatorPresetModalProps) {
    const [selectedPresetKey, setSelectedPresetKey] = useState<string>("")

    // Reset selection when modal opens
    useEffect(() => {
        if (open) {
            setSelectedPresetKey(initialSelectedPreset?.key || presets[0]?.key || "")
        }
    }, [open, initialSelectedPreset?.key, presets])

    const selectedPreset = useMemo(
        () => presets.find((p) => p.key === selectedPresetKey) ?? null,
        [selectedPresetKey, presets],
    )

    const handleLoadPreset = () => {
        if (!selectedPreset) return
        onLoadPreset(selectedPreset)
        onCancel?.({} as React.MouseEvent<HTMLButtonElement>)
    }

    const footer = (
        <div className="flex items-center justify-end gap-2">
            <Button onClick={(e) => onCancel?.(e as React.MouseEvent<HTMLButtonElement>)}>
                Cancel
            </Button>
            <Button type="primary" disabled={!selectedPreset} onClick={handleLoadPreset}>
                Load Preset
            </Button>
        </div>
    )

    return (
        <Modal
            width={1150}
            className={clsx(
                "[&_.ant-modal-content]:h-full [&_.ant-modal-content]:overflow-y-auto",
                "[&_.ant-modal-body]:h-[600px]",
            )}
            title="Load Preset"
            footer={footer}
            open={open}
            onCancel={onCancel}
            {...modalProps}
        >
            <PresetContent
                presets={presets}
                selectedPresetKey={selectedPresetKey}
                onSelectPreset={setSelectedPresetKey}
                selectedPreset={selectedPreset}
            />
        </Modal>
    )
})

export default LoadEvaluatorPresetModal
