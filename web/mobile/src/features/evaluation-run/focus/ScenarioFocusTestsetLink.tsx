import {runReferencesAtomFamily, type EvaluationRunKind} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import {Button} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import Link from "next/link"

import {useRunReferenceLinks} from "../overview/useRunReferenceLinks"
import type {ScenarioRow} from "../scenarios/scenarioColumns"

/**
 * "Open in test set": the run's revision of this test case's test set, with the editor open on
 * the test case. Not shown for an online run (it reads traces), when the test sets view is off,
 * or when the run has no revision of that test set.
 */
export const ScenarioFocusTestsetLink = ({
    runId,
    kind,
    row,
}: {
    runId: string
    kind: EvaluationRunKind
    row: ScenarioRow
}) => {
    const t = useT(focusCatalog)
    const references = useAtomValue(runReferencesAtomFamily(runId))
    const links = useRunReferenceLinks()
    const revisionId = references?.testsets.find(
        (testset) => testset.testsetId === row.testsetId,
    )?.revisionId
    const href =
        kind !== "online" && revisionId && row.testcaseId
            ? links.testcase(revisionId, row.testcaseId)
            : null
    if (!href) return null
    return (
        <Button asChild variant="outline" size="xs">
            <Link href={href} prefetch={false}>
                {t("evaluations.scenarioFocus.openInTestSet")}
                <ArrowSquareOut data-icon="inline-end" />
            </Link>
        </Button>
    )
}
