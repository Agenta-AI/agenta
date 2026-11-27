import {useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import {useEvaluatorNavigation} from "@agenta/observability/traceDrawer"
import {linksAndReferencesAtom} from "@agenta/observability/traceDrawer"
import {useAtomValue} from "jotai"

import {mergeReferenceChips, type TraceReference} from "../references/mergeReferenceChips"
import {ReferenceChipList} from "../references/ReferenceChipList"

/**
 * The References section of the side panel: one chip per entity (`ReferenceChipList`). An
 * evaluator chip links to the evaluator page the drawer knows. No section without references.
 */
const TraceReferences = () => {
    const t = useT(drawerCatalog)
    const linksAndReferences = useAtomValue(linksAndReferencesAtom)
    const {buildEvaluatorTarget} = useEvaluatorNavigation()
    const references = (linksAndReferences?.references ?? []) as TraceReference[]

    if (mergeReferenceChips(references).length === 0) return null

    return (
        <section className="flex flex-col gap-2" data-testid="trace-references">
            <h3 className="m-0 text-label">{t("observabilityUi.traceDrawer.references")}</h3>
            <ReferenceChipList
                references={references}
                hrefOf={(chip) =>
                    chip.kind === "evaluator"
                        ? buildEvaluatorTarget({
                              id: chip.entity?.id ?? undefined,
                              slug: chip.entity?.slug ?? undefined,
                          })?.href
                        : undefined
                }
            />
        </section>
    )
}

export default TraceReferences
