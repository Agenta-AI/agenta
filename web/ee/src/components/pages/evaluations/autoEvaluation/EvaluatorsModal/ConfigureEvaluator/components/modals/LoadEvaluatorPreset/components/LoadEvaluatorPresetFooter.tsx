import React from "react"

import {Button} from "@agenta/primitive-ui/components/button"

import {LoadEvaluatorPresetFooterProps} from "../assets/types"

const LoadEvaluatorPresetFooter = ({
    onClose,
    selectedPreset,
    handleLoadPreset,
}: LoadEvaluatorPresetFooterProps) => {
    return (
        <div className="flex items-center justify-end gap-2">
            <Button onClick={() => onClose()} variant="outline">
                Cancel
            </Button>

            <Button disabled={!selectedPreset} onClick={handleLoadPreset}>
                Load Preset
            </Button>
        </div>
    )
}

export default LoadEvaluatorPresetFooter
