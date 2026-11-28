import {useRef} from "react"

import {CopyValueButton, ValueFieldTable} from "@agenta/chat/value-view"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import statusCatalog from "@agenta/i18n/catalogs/ui.status"
import {Badge} from "@agenta/ui/ui"

import {FieldEditor} from "../../testsets/detail/fields/FieldEditor"
import {
    editorKind,
    pickFieldEditor,
    type FieldEditorPick,
} from "../../testsets/detail/fields/pickFieldEditor"
import type {ScenarioCell} from "../scenarios/scenarioColumns"

import {useTestcaseDraftContext, type TestcaseDraft} from "./useTestcaseDraft"

/**
 * The inputs as the test case editor's controlled fields, while "Edit fields" is on in the
 * Annotate panel. Each field keeps the editor its first value picked; a changed field shows
 * "Edited".
 */
const EditableInputs = ({cells, draft}: {cells: ScenarioCell[]; draft: TestcaseDraft}) => {
    const t = useT(statusCatalog)
    const picks = useRef(new Map<string, FieldEditorPick>())
    const pickOf = (name: string, value: unknown) => {
        let pick = picks.current.get(name)
        if (!pick) {
            pick = pickFieldEditor(value)
            picks.current.set(name, pick)
        }
        return pick
    }
    return (
        <div className="flex flex-col gap-3">
            {cells.map(({name}) => {
                const value = draft.values[name]
                const pick = pickOf(name, value)
                return (
                    <div key={name} className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-2 text-meta text-muted-foreground">
                            {name}
                            {draft.editedFields.includes(name) ? (
                                <Badge variant="info">{t("ui.status.edited")}</Badge>
                            ) : null}
                        </span>
                        <FieldEditor
                            name={name}
                            value={value}
                            pick={pick}
                            kind={editorKind(pick, pick.defaultView)}
                            view={pick.defaultView}
                            markdownEdit
                            collapseSignal={0}
                            onChange={(next) => draft.setField(name, next)}
                        />
                    </div>
                )
            })}
        </div>
    )
}

/**
 * The test case inputs under their title and count, as one key and value table. While the
 * Annotate panel edits the test case they are editable in place.
 */
export const ScenarioFocusInputsTable = ({cells}: {cells: ScenarioCell[]}) => {
    const t = useT(focusCatalog, valueViewCatalog)
    const draft = useTestcaseDraftContext()
    const editing = Boolean(draft?.editing && draft.ready)
    const fields = cells.map((cell) => ({
        name: cell.name,
        value: draft && cell.name in draft.values ? draft.values[cell.name] : cell.value,
    }))
    return (
        <section aria-label={t("evaluations.scenarioFocus.inputs")} className="flex flex-col gap-2">
            <div className="flex min-h-7 items-center justify-between gap-2">
                <h3 className="m-0 flex items-baseline gap-2 text-label">
                    {t("evaluations.scenarioFocus.inputs")}
                    <span className="text-meta font-normal text-muted-foreground">
                        {t("chat.valueView.fields", {count: cells.length})}
                    </span>
                </h3>
                <CopyValueButton
                    value={Object.fromEntries(fields.map(({name, value}) => [name, value]))}
                    label={t("evaluations.scenarioFocus.copyInputs")}
                />
            </div>
            {editing && draft ? (
                <EditableInputs cells={cells} draft={draft} />
            ) : (
                <ValueFieldTable fields={fields} />
            )}
        </section>
    )
}
