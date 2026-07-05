/**
 * EntitySaveContent Component
 *
 * Modal content with name input and save-as-new option.
 */

import {Alert, AlertTitle, AlertDescription} from "@agenta/primitive-ui/components/alert"
import {WarningCircle} from "@phosphor-icons/react"
import {Input, Checkbox} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    saveModalEntityAtom,
    saveModalNameAtom,
    saveModalSaveAsNewAtom,
    saveModalErrorAtom,
    saveModalOriginalNameAtom,
    setSaveNameAtom,
    toggleSaveAsNewAtom,
} from "../state"

/**
 * EntitySaveContent
 *
 * Shows:
 * - Name input field
 * - Save as new checkbox (when editing existing entity)
 * - Original name hint (when save-as-new)
 * - Error alert if any
 */
export function EntitySaveContent() {
    const entity = useAtomValue(saveModalEntityAtom)
    const name = useAtomValue(saveModalNameAtom)
    const saveAsNew = useAtomValue(saveModalSaveAsNewAtom)
    const originalName = useAtomValue(saveModalOriginalNameAtom)
    const error = useAtomValue(saveModalErrorAtom)
    const setName = useSetAtom(setSaveNameAtom)
    const toggleSaveAsNew = useSetAtom(toggleSaveAsNewAtom)

    const isNewEntity = entity === null
    const showSaveAsNewOption = !isNewEntity

    return (
        <div className="flex flex-col gap-4">
            {/* Name input */}
            <div className="flex flex-col gap-2">
                <label htmlFor="entity-name" className="font-medium text-gray-700">
                    Name
                </label>
                <Input
                    id="entity-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter a name..."
                    autoFocus
                />
            </div>

            {/* Save as new option */}
            {showSaveAsNewOption && (
                <div className="flex flex-col gap-2">
                    <Checkbox checked={saveAsNew} onChange={() => toggleSaveAsNew()}>
                        Save as new copy
                    </Checkbox>
                    {saveAsNew && originalName && (
                        <p className="text-gray-500 ml-6">
                            Original: <span className="font-medium">{originalName}</span>
                        </p>
                    )}
                </div>
            )}

            {/* Error display */}
            {error && (
                <Alert variant="destructive" icon={<WarningCircle size={16} />}>
                    <AlertTitle>Save failed</AlertTitle>
                    <AlertDescription>{error.message}</AlertDescription>
                </Alert>
            )}
        </div>
    )
}
