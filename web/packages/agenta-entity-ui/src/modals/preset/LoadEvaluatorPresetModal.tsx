/**
 * LoadEvaluatorPresetModal
 *
 * Modal for selecting and loading evaluator presets.
 * Shows a list of available presets with YAML/JSON preview.
 */

import {memo, useState, useMemo, useEffect} from "react"

import {useT} from "@agenta/i18n"
import presetModalCatalog from "@agenta/i18n/catalogs/entityUi.presetModal"
import {
    Button,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"

import {PresetContent} from "./PresetContent"
import type {LoadEvaluatorPresetModalProps} from "./types"

export const LoadEvaluatorPresetModal = memo(function LoadEvaluatorPresetModal({
    presets,
    selectedPreset: initialSelectedPreset,
    onLoadPreset,
    open,
    onCancel,
}: LoadEvaluatorPresetModalProps) {
    const t = useT(presetModalCatalog)
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
        onCancel?.()
    }

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onCancel?.()}>
            <DialogContent className="max-w-[1150px]">
                <DialogHeader>
                    <DialogTitle>{t("entityUi.presetModal.loadPreset")}</DialogTitle>
                </DialogHeader>
                <div className="h-150 min-h-0 overflow-y-auto">
                    <PresetContent
                        presets={presets}
                        selectedPresetKey={selectedPresetKey}
                        onSelectPreset={setSelectedPresetKey}
                        selectedPreset={selectedPreset}
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onCancel?.()}>
                        {t("entityUi.presetModal.cancel")}
                    </Button>
                    <Button disabled={!selectedPreset} onClick={handleLoadPreset}>
                        {t("entityUi.presetModal.loadPreset")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
})

export default LoadEvaluatorPresetModal
