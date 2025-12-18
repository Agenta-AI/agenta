import React, {useEffect, useMemo} from "react"

import clsx from "clsx"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {LoadEvaluatorPresetProps} from "./assets/types"
import LoadEvaluatorPresetContent from "./components/LoadEvaluatorPresetContent"
import LoadEvaluatorPresetFooter from "./components/LoadEvaluatorPresetFooter"

const LoadEvaluatorPreset = ({
    settingsPresets,
    selectedSettingsPreset,
    setSelectedSettingsPreset,
    applySettingsValues,
    ...modalProps
}: LoadEvaluatorPresetProps) => {
    const defaultPresetKey = selectedSettingsPreset?.key ?? settingsPresets[0]?.key ?? ""

    const [selectedPresetKey, setSelectedPresetKey] = React.useState<string>(defaultPresetKey)

    useEffect(() => {
        if (modalProps.open && !selectedPresetKey) {
            setSelectedPresetKey(defaultPresetKey)
        }
    }, [modalProps.open, defaultPresetKey, selectedPresetKey])

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
