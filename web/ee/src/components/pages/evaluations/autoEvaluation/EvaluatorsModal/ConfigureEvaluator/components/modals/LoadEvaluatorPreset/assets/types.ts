import {SettingsPreset} from "@/oss/lib/Types"
import {ModalProps} from "antd"

export interface LoadEvaluatorPresetProps extends ModalProps {
    settingsPresets: SettingsPreset[]
    selectedSettingsPreset: SettingsPreset | null
    setSelectedSettingsPreset: React.Dispatch<React.SetStateAction<SettingsPreset | null>>
    applySettingsValues: (settingsValues: Record<string, any> | null | undefined) => void
}

export interface LoadEvaluatorPresetContentProps {
    settingsPresets: SettingsPreset[]
    selectedPresetKey: string
    setSelectedPresetKey: React.Dispatch<React.SetStateAction<string>>
    selectedPreset: SettingsPreset | null
}

export interface LoadEvaluatorPresetFooterProps {
    onClose: () => void
    selectedPreset: SettingsPreset | null
    handleLoadPreset: () => void
}
