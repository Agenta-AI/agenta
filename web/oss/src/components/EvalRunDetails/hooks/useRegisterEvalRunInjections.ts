/**
 * OSS provider seam for the relocated eval-run atom layer (`@agenta/evaluations/state/evalRun`).
 *
 * The eval-run runtime atoms now live in `@agenta/evaluations` and read their app-wide,
 * OSS-state-coupled dependencies through the injection seams in
 * `@agenta/evaluations/state` (`registerEvalRunInjections` + the `injected*Atom` family).
 * This hook is the single place the OSS app populates those seams with the REAL OSS
 * sources, so the relocated atoms behave exactly as they did in-app.
 *
 * Mount it once at the eval-run view root (see `EvalRunDetails/components/Page.tsx`).
 */

import {useEffect} from "react"

import {registerEvalRunInjections, type InjectedReferenceResolver} from "@agenta/evaluations/state"
import {clearMetricSelectionCache} from "@agenta/evaluations/state/runsTable"
import {invalidateEvaluationRunsTableAtom} from "@agenta/evaluations-ui"
import {useAtomValue, useSetAtom} from "jotai"

import {
    appReferenceAtomFamily,
    variantReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
} from "@/oss/components/References/atoms/entityReferences"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import {testcaseQueryAtomFamily} from "@/oss/state/entities/testcase"
import {workspaceMembersAtom} from "@/oss/state/workspace/atoms/selectors"

/** The three entity-reference resolver families, bundled to match the injected shape. */
const referenceResolver: InjectedReferenceResolver = {
    appReferenceAtomFamily,
    variantReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
}

/**
 * Registers every eval-run injection seam from its real OSS source. The workspace member
 * list is reactive (re-registered whenever it changes); the rest are stable references.
 */
export const useRegisterEvalRunInjections = () => {
    const workspaceMembers = useAtomValue(workspaceMembersAtom)
    const registerInjections = useSetAtom(registerEvalRunInjections)
    const invalidateRunsTable = useSetAtom(invalidateEvaluationRunsTableAtom)

    useEffect(() => {
        registerInjections({
            workspaceMembers,
            testcaseQueryFamily: testcaseQueryAtomFamily,
            referenceResolver,
            runInvalidate: () => invalidateRunsTable(),
            clearMetricSelection: clearMetricSelectionCache,
            annotationTransform: transformApiData,
            // The run-details view consumes no online-evaluations runtime fn (query.ts uses
            // only the payload TYPES). The run-list host (`EvalRunsViewHost`) registers the
            // real start/stop impls; leaving the key unset here keeps the seam intact.
        })
    }, [workspaceMembers, registerInjections, invalidateRunsTable])
}
