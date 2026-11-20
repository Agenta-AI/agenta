/**
 * EntitySaveContent Component
 *
 * Modal content with name input and save-as-new option.
 */

import {richText, useT} from "@agenta/i18n"
import saveModalCatalog from "@agenta/i18n/catalogs/entityUi.saveModal"
import {Alert, Checkbox, Input} from "@agenta/ui/ui"
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
    const t = useT(saveModalCatalog)
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
                    {t("entityUi.saveModal.name")}
                </label>
                <Input
                    id="entity-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("entityUi.saveModal.namePlaceholder")}
                    autoFocus
                />
            </div>

            {/* Save as new option */}
            {showSaveAsNewOption && (
                <div className="flex flex-col gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                        <Checkbox checked={saveAsNew} onCheckedChange={() => toggleSaveAsNew()} />
                        <span>{t("entityUi.saveModal.saveAsNewCopy")}</span>
                    </label>
                    {saveAsNew && originalName && (
                        <p className="text-gray-500 ml-6">
                            {richText(t("entityUi.saveModal.original", {name: originalName}), {
                                name: (text) => <span className="font-medium">{text}</span>,
                            })}
                        </p>
                    )}
                </div>
            )}

            {/* Error display */}
            {error && (
                <Alert
                    type="error"
                    message={t("entityUi.saveModal.saveFailed")}
                    description={error.message}
                    showIcon
                />
            )}
        </div>
    )
}
