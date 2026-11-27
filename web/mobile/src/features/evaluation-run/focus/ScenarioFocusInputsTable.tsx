import {CopyValueButton, ValueFieldTable} from "@agenta/chat/value-view"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"

import type {ScenarioCell} from "../scenarios/scenarioColumns"

/** The test case inputs under their title and count, as one key and value table. */
export const ScenarioFocusInputsTable = ({cells}: {cells: ScenarioCell[]}) => {
    const t = useT(focusCatalog, valueViewCatalog)
    const fields = cells.map((cell) => ({name: cell.name, value: cell.value}))
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
                />
            </div>
            <ValueFieldTable fields={fields} />
        </section>
    )
}
