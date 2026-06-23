/**
 * OSS host boundary for the relocated eval run-list view (`@agenta/evaluations-ui`
 * `EvaluationRunsTable` / `LatestEvaluationRunsTable`, WP-4h-4).
 *
 * The run-list view was moved into `@agenta/evaluations-ui` but legitimately depends on
 * OSS-app-owned components (reference cells, empty states, modals/drawers, the date-range
 * picker, the online-eval filters preview), OSS hooks (routing/permissions), OSS app-state
 * atoms (apps/url/route/queries/workflow/onboarding), and a few OSS pure functions
 * (URL builders, payload normalizers). Rather than relocate those, this boundary supplies
 * them through the three seam channels (§12.1c):
 *
 *   1. atoms  → `registerEvalRunInjections` (`@agenta/evaluations/state`)
 *   2. fns    → `registerEvalViewFns`       (`@agenta/evaluations-ui`)
 *   3. slots  → `EvalViewHostProvider`      (`@agenta/evaluations-ui`)
 *
 * Wrap every OSS render site of the run-list view in `<EvalRunsViewHost>`.
 */

import {memo, useEffect, useMemo, type ComponentProps, type ReactNode} from "react"

import {registerEvalRunInjections, type InjectedReferenceResolver} from "@agenta/evaluations/state"
import {clearMetricSelectionCache} from "@agenta/evaluations/state/runsTable"
import {
    EvalViewHostProvider,
    invalidateEvaluationRunsTableAtom,
    registerEvalViewFns,
    registerRunViewInjections,
    type EvalViewHost,
    type EvalViewUrlState,
    type InjectedUrlState,
} from "@agenta/evaluations-ui"
import {useAtomValue, useSetAtom} from "jotai"

import DeleteEvaluationModal from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"
import EditEvaluationDrawer from "@/oss/components/EditEvaluationDrawer"
import QuickDateRangePicker from "@/oss/components/Filters/QuickDateRangePicker"
import EmptyStateAllEvaluations from "@/oss/components/pages/evaluations/allEvaluations/EmptyStateAllEvaluations"
import EmptyStateEvaluation from "@/oss/components/pages/evaluations/autoEvaluation/EmptyStateEvaluation"
import EmptyStateHumanEvaluation from "@/oss/components/pages/evaluations/humanEvaluation/EmptyStateHumanEvaluation"
import NewEvaluationModal from "@/oss/components/pages/evaluations/NewEvaluation"
import type {EvalStepSlot} from "@/oss/components/pages/evaluations/NewEvaluation/evalSteps/types"
import {fromFilteringPayload} from "@/oss/components/pages/evaluations/onlineEvaluation/assets/helpers"
import FiltersPreview from "@/oss/components/pages/evaluations/onlineEvaluation/components/FiltersPreview"
import EmptyStateOnlineEvaluation from "@/oss/components/pages/evaluations/onlineEvaluation/EmptyStateOnlineEvaluation"
import OnlineEvaluationDrawer from "@/oss/components/pages/evaluations/onlineEvaluation/OnlineEvaluationDrawer"
import EmptyStateSdkEvaluation from "@/oss/components/pages/evaluations/sdkEvaluation/EmptyStateSdkEvaluation"
import SetupEvaluationModal from "@/oss/components/pages/evaluations/SetupEvaluationModal"
import {
    extractPrimaryInvocation,
    buildAppScopedUrl,
    buildEvaluationNavigationUrl,
} from "@/oss/components/pages/evaluations/utils"
import {
    appReferenceAtomFamily,
    variantReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
    evaluatorReferenceAtomFamily,
} from "@/oss/components/References/atoms/entityReferences"
import {getEvaluatorMetricBlueprintAtom} from "@/oss/components/References/atoms/metricBlueprint"
import {resolvedMetricLabelsAtomFamily} from "@/oss/components/References/atoms/resolvedMetricLabels"
import {PreviewAppCell} from "@/oss/components/References/cells/ApplicationCells"
import {PreviewCreatedByCell} from "@/oss/components/References/cells/CreatedByCells"
import {PreviewEvaluatorCell} from "@/oss/components/References/cells/EvaluatorCells"
import {PreviewQueryCell} from "@/oss/components/References/cells/QueryCells"
import {PreviewTestsetCell} from "@/oss/components/References/cells/TestsetCells"
import {PreviewVariantCell} from "@/oss/components/References/cells/VariantCells"
import useEvaluatorReference from "@/oss/components/References/hooks/useEvaluatorReference"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import {
    onboardingWidgetActivationAtom,
    recordWidgetEventAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import {startSimpleEvaluation, stopSimpleEvaluation} from "@/oss/services/onlineEvaluations/api"
import {appsQueryAtom, routerAppIdAtom} from "@/oss/state/app"
import {appIdentifiersAtom, routeLayerAtom, useQueryParamState} from "@/oss/state/appState"
import {queriesQueryAtomFamily} from "@/oss/state/queries"
import {urlAtom, waitForValidURL} from "@/oss/state/url"
import {currentWorkflowAtom} from "@/oss/state/workflow"
import {
    workspaceMemberByIdFamily,
    workspaceMembersAtom,
} from "@/oss/state/workspace/atoms/selectors"

const EVALUATION_PAGE_STEPS: EvalStepSlot[] = [
    {kind: "invocation", required: true},
    {kind: "revision", required: true, dependsOn: ["invocation"]},
    {kind: "testset", required: true, dependsOn: ["invocation"]},
    {kind: "evaluator", required: true, dependsOn: ["invocation"]},
    {kind: "advanced", required: true},
]

const EvaluationPageNewEvaluationModal = (props: ComponentProps<typeof NewEvaluationModal>) => (
    <NewEvaluationModal {...props} steps={EVALUATION_PAGE_STEPS} />
)

/** Three entity-reference resolver families, bundled to match the injected shape. */
const referenceResolver: InjectedReferenceResolver = {
    appReferenceAtomFamily,
    variantReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
}

// fn-channel registration is global + stable; do it once at module load. The seam types are
// intentionally looser than the OSS impls (it owns the concrete `URLState`/`EvaluationRow`/
// `QueryFilteringPayload` shapes), so the structurally-compatible impls are adapted at the
// boundary.
registerEvalViewFns({
    waitForValidURL: async (options): Promise<EvalViewUrlState> =>
        (await waitForValidURL(options)) as unknown as EvalViewUrlState,
    buildAppScopedUrl,
    buildEvaluationNavigationUrl,
    buildRevisionsQueryParam,
    extractPrimaryInvocation: (evaluation) =>
        extractPrimaryInvocation(evaluation as Parameters<typeof extractPrimaryInvocation>[0]),
    fromFilteringPayload: (payload) =>
        fromFilteringPayload(payload as Parameters<typeof fromFilteringPayload>[0]),
})

/** Registers the run-list atom seams from their real OSS sources (reactive where needed). */
const useRegisterEvalRunsViewInjections = () => {
    const register = useSetAtom(registerEvalRunInjections)
    const registerView = useSetAtom(registerRunViewInjections)
    const workspaceMembers = useAtomValue(workspaceMembersAtom)
    const apps = useAtomValue(appsQueryAtom)
    const routerAppId = useAtomValue(routerAppIdAtom)
    const url = useAtomValue(urlAtom)
    const appIdentifiers = useAtomValue(appIdentifiersAtom)
    const routeLayer = useAtomValue(routeLayerAtom)
    const currentWorkflow = useAtomValue(currentWorkflowAtom)
    const onboardingWidgetActivation = useAtomValue(onboardingWidgetActivationAtom)
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)
    const invalidateRunsTable = useSetAtom(invalidateEvaluationRunsTableAtom)

    useEffect(() => {
        // shared eval-run seams (headless @agenta/evaluations)
        register({
            workspaceMembers,
            referenceResolver,
            clearMetricSelection: clearMetricSelectionCache,
            runInvalidate: () => invalidateRunsTable(),
        })
        // run-view seams (relocated to @agenta/evaluations-ui)
        registerView({
            onlineEvaluationsApi: {startSimpleEvaluation, stopSimpleEvaluation},
            appsQuery: apps,
            routerAppId,
            url: url as unknown as InjectedUrlState,
            appIdentifiers,
            routeLayer,
            currentWorkflow,
            queriesQueryFamily: queriesQueryAtomFamily,
            metricBlueprintFactory: getEvaluatorMetricBlueprintAtom,
            resolvedMetricLabelsFamily: resolvedMetricLabelsAtomFamily,
            evaluatorReferenceFamily: evaluatorReferenceAtomFamily,
            workspaceMemberByIdFamily,
            onboardingWidgetActivation,
            setOnboardingWidgetActivation: (value) => setOnboardingWidgetActivation(value),
            recordWidgetEvent: (eventId) => recordWidgetEvent(eventId),
        })
    }, [
        register,
        registerView,
        workspaceMembers,
        apps,
        routerAppId,
        url,
        appIdentifiers,
        routeLayer,
        currentWorkflow,
        onboardingWidgetActivation,
        setOnboardingWidgetActivation,
        recordWidgetEvent,
        invalidateRunsTable,
    ])
}

/** Wraps the relocated run-list view, supplying every OSS seam it depends on. */
const EvalRunsViewHost = ({children}: {children: ReactNode}) => {
    useRegisterEvalRunsViewInjections()

    const host = useMemo<EvalViewHost>(
        () => ({
            components: {
                PreviewAppCell,
                PreviewVariantCell,
                PreviewTestsetCell,
                PreviewQueryCell,
                PreviewEvaluatorCell,
                PreviewCreatedByCell,
                QuickDateRangePicker,
                FiltersPreview,
                EmptyStateAllEvaluations,
                EmptyStateEvaluation,
                EmptyStateHumanEvaluation,
                EmptyStateOnlineEvaluation,
                EmptyStateSdkEvaluation,
                DeleteEvaluationModal,
                NewEvaluationModal: EvaluationPageNewEvaluationModal,
                OnlineEvaluationDrawer,
                SetupEvaluationModal,
                EditEvaluationDrawer,
            },
            hooks: {
                useProjectPermissions,
                useQueryParamState,
                useEvaluatorReference,
            },
        }),
        [],
    )

    return <EvalViewHostProvider host={host}>{children}</EvalViewHostProvider>
}

export default memo(EvalRunsViewHost)
