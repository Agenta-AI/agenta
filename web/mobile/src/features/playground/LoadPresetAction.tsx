import {useState} from "react"

import {
    evaluatorPresetsAtomFamily,
    parseEvaluatorKeyFromUri,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {Button} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

// The dialog loads when it is first opened.
const LoadEvaluatorPresetModal = dynamic(
    () => import("@agenta/entity-ui/modals").then((m) => m.LoadEvaluatorPresetModal),
    {ssr: false},
)

/**
 * "Load Preset" on a built-in evaluator whose template has presets. A preset replaces the
 * evaluator's settings in its draft; nothing is saved until the reader commits.
 */
export const LoadPresetAction = ({revisionId}: {revisionId: string}) => {
    const [open, setOpen] = useState(false)
    const uri = useAtomValue(workflowMolecule.selectors.uri(revisionId))
    const isEvaluator = useAtomValue(workflowMolecule.selectors.isEvaluator(revisionId))
    // Built-in apps carry an `agenta:builtin:` address too, so the evaluator flag decides.
    const templateKey =
        isEvaluator && uri?.startsWith("agenta:builtin:") ? parseEvaluatorKeyFromUri(uri) : null
    const presets = useAtomValue(evaluatorPresetsAtomFamily(templateKey))
    const updateConfiguration = useSetAtom(workflowMolecule.actions.updateConfiguration)

    if (presets.length === 0) return null
    return (
        <>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                Load Preset
            </Button>
            {open ? (
                <LoadEvaluatorPresetModal
                    open
                    presets={presets}
                    onCancel={() => setOpen(false)}
                    onLoadPreset={(preset) => updateConfiguration(revisionId, preset.values)}
                />
            ) : null}
        </>
    )
}
