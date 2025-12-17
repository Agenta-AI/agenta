import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import React, {useEffect, useMemo} from "react"
import {LoadEvaluatorPresetProps} from "./assets/types"
import LoadEvaluatorPresetContent from "./components/LoadEvaluatorPresetContent"
import LoadEvaluatorPresetFooter from "./components/LoadEvaluatorPresetFooter"
import clsx from "clsx"

const LoadEvaluatorPreset = ({
    settingsPresets,
    selectedSettingsPreset,
    setSelectedSettingsPreset,
    applySettingsValues,
    ...modalProps
}: LoadEvaluatorPresetProps) => {
    const [selectedPresetKey, setSelectedPresetKey] = React.useState<string>(
        () => selectedSettingsPreset?.key ?? settingsPresets[0]?.key ?? "",
    )

    useEffect(() => {
        if (!modalProps.open) return
        setSelectedPresetKey(
            (prev) => prev || selectedSettingsPreset?.key || settingsPresets[0]?.key || "",
        )
    }, [modalProps.open, settingsPresets, selectedSettingsPreset])

    const selectedPreset = useMemo(
        () => settingsPresets.find((p) => p.key === selectedPresetKey) ?? null,
        [selectedPresetKey, settingsPresets],
    )

    const handleLoadPreset = () => {
        if (!selectedPreset) return
        setSelectedSettingsPreset(selectedPreset)
        applySettingsValues(selectedPreset.values)
        modalProps.onCancel?.({} as any)
    }

    return (
        <EnhancedModal
            width={1150}
            className={clsx(
                "[&_.ant-modal-content]:h-full [&_.ant-modal-content]:overflow-y-auto",
                "[&_.ant-modal-body]:h-[600px]",
            )}
            title="Load Preset"
            footer={
                <LoadEvaluatorPresetFooter
                    onClose={() => modalProps.onCancel?.({} as any)}
                    selectedPreset={selectedPreset}
                    handleLoadPreset={handleLoadPreset}
                />
            }
            {...modalProps}
        >
            <LoadEvaluatorPresetContent
                settingsPresets={settingsPresets}
                selectedPresetKey={selectedPresetKey}
                setSelectedPresetKey={setSelectedPresetKey}
                selectedPreset={selectedPreset}
            />
        </EnhancedModal>
    )
}

export default LoadEvaluatorPreset
