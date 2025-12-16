import {Button} from "antd"
import React from "react"
import {LoadEvaluatorPresetFooterProps} from "../assets/types"

const LoadEvaluatorPresetFooter = ({
    onClose,
    selectedPreset,
    handleLoadPreset,
}: LoadEvaluatorPresetFooterProps) => {
    return (
        <div className="flex items-center justify-end gap-2">
            <Button onClick={() => onClose()}>Cancel</Button>

            <Button type="primary" disabled={!selectedPreset} onClick={handleLoadPreset}>
                Load Preset
            </Button>
        </div>
    )
}

export default LoadEvaluatorPresetFooter
