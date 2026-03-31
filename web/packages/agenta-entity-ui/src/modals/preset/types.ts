/**
 * Types for LoadEvaluatorPresetModal
 */

import type {ModalProps} from "antd"

/**
 * Evaluator preset definition
 */
export interface EvaluatorPreset {
    key: string
    name: string
    values: Record<string, unknown>
}

/**
 * Props for LoadEvaluatorPresetModal
 */
export interface LoadEvaluatorPresetModalProps extends Omit<ModalProps, "onOk"> {
    /** Available presets to choose from */
    presets: EvaluatorPreset[]
    /** Currently selected preset (for highlighting) */
    selectedPreset?: EvaluatorPreset | null
    /** Callback when a preset is loaded */
    onLoadPreset: (preset: EvaluatorPreset) => void
}

/**
 * Props for the preset content component
 */
export interface PresetContentProps {
    presets: EvaluatorPreset[]
    selectedPresetKey: string
    onSelectPreset: (key: string) => void
    selectedPreset: EvaluatorPreset | null
}
