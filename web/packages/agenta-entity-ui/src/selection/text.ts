/**
 * Text of the selection pickers in the active language.
 *
 * Adapters and hosts give level labels ("Workflow", "Revision") and empty or loading texts as
 * plain English strings, and some of them are also data (a level label is part of a selection's
 * path). The pickers translate them only where they show them: the built-in English texts map to
 * the `entityUi.selection` catalog, and a host's own text shows as it is.
 */
import {createT, getActiveLanguage, type CatalogKey} from "@agenta/i18n"
import selectionCatalog from "@agenta/i18n/catalogs/entityUi.selection"

type SelectionKey = CatalogKey<typeof selectionCatalog>

export const tSelection = createT(selectionCatalog)

const LEVEL_LABEL_KEYS: Record<string, SelectionKey> = {
    App: "entityUi.selection.levelApp",
    Application: "entityUi.selection.levelApplication",
    Evaluator: "entityUi.selection.levelEvaluator",
    Item: "entityUi.selection.levelItem",
    Revision: "entityUi.selection.levelRevision",
    Testset: "entityUi.selection.levelTestset",
    Variant: "entityUi.selection.levelVariant",
    Workflow: "entityUi.selection.levelWorkflow",
}

const ADAPTER_TEXT_KEYS: Record<string, SelectionKey> = {
    "No evaluators found": "entityUi.selection.noEvaluators",
    "Loading evaluators...": "entityUi.selection.loadingEvaluators",
    "No testsets found": "entityUi.selection.noTestsets",
    "Loading testsets...": "entityUi.selection.loadingTestsets",
    "No variants found": "entityUi.selection.noVariants",
    "Loading variants...": "entityUi.selection.loadingVariants",
    "No workflows found": "entityUi.selection.noWorkflows",
    "Loading workflows...": "entityUi.selection.loadingWorkflows",
}

/** A level label for display: a built-in label in the active language, any other as it is. */
export const levelLabelText = (label: string): string => {
    const key = LEVEL_LABEL_KEYS[label]
    return key ? tSelection(key) : label
}

/** An adapter's built-in empty or loading text in the active language, any other as it is. */
export const adapterText = (text: string): string => {
    const key = ADAPTER_TEXT_KEYS[text]
    return key ? tSelection(key) : text
}

/**
 * A level label inside a sentence ("Search workflow..."). It is lowercased as in English,
 * except in German, where nouns keep their capital letter.
 */
export const labelInSentence = (label: string): string =>
    getActiveLanguage() === "de-DE" ? label : label.toLowerCase()

/** A level type ("revision") inside a sentence, translated when it is a built-in level. */
export const typeInSentence = (type: string): string => {
    const key = LEVEL_LABEL_KEYS[type.charAt(0).toUpperCase() + type.slice(1)]
    return key ? labelInSentence(tSelection(key)) : type
}
