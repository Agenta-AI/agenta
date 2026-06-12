/**
 * OSS host boundary for the relocated eval run-details view (`@agenta/evaluations-ui`
 * `EvalRunDetailsPage` / `EvalRunFocusDrawerMount`, WP-4h-5).
 *
 * The run-details view was moved into `@agenta/evaluations-ui` but legitimately depends on
 * OSS-app-owned components (reference cells/labels, the generic + annotate drawers, the
 * shared trace-result viewer, the prompt drill-in provider, the editor), OSS hooks
 * (routing/breadcrumbs/permissions/evaluator details), OSS app-state atoms (workspace
 * members, testcase query, reference resolvers, navigation request), and a few OSS pure
 * functions (annotation transforms + services, date formatter, the evaluator-category
 * label map). Rather than relocate those, this boundary supplies them through the three
 * seam channels (§12.1c):
 *
 *   1. atoms  → `registerEvalRunInjections` (`@agenta/evaluations/state`)
 *   2. fns    → `registerEvalViewFns`       (`@agenta/evaluations-ui`)
 *   3. slots  → `EvalViewHostProvider`      (`@agenta/evaluations-ui`)
 *
 * Wrap every OSS render site of the run-details view in `<EvalRunDetailsViewHost>`: the six
 * route pages (oss+ee × {results, single_model_test} × {project, app}) AND the global
 * `AppGlobalWrappers` mount of `EvalRunFocusDrawerMount`.
 */

import {memo, useEffect, useMemo, type ReactNode} from "react"

import {
    registerEvalRunInjections,
    type InjectedNavigationCommand,
    type InjectedReferenceResolver,
} from "@agenta/evaluations/state"
import {clearMetricSelectionCache} from "@agenta/evaluations/state/runsTable"
import {
    EvalViewHostProvider,
    invalidateEvaluationRunsTableAtom,
    registerEvalViewFns,
    type EvalViewHost,
} from "@agenta/evaluations-ui"
import {type Atom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import CustomTreeComponent from "@/oss/components/CustomUIs/CustomTreeComponent"
import {OSSdrillInUIProvider} from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import GenericDrawer from "@/oss/components/GenericDrawer"
import EvaluatorDetailsPreview from "@/oss/components/pages/evaluations/onlineEvaluation/components/EvaluatorDetailsPreview"
import FiltersPreview from "@/oss/components/pages/evaluations/onlineEvaluation/components/FiltersPreview"
import {EVALUATOR_CATEGORY_LABEL_MAP} from "@/oss/components/pages/evaluations/onlineEvaluation/constants"
import {useEvaluatorDetails} from "@/oss/components/pages/evaluations/onlineEvaluation/hooks/useEvaluatorDetails"
import {useEvaluatorTypeFromConfigs} from "@/oss/components/pages/evaluations/onlineEvaluation/hooks/useEvaluatorTypeFromConfigs"
import {useEvaluatorTypeMeta} from "@/oss/components/pages/evaluations/onlineEvaluation/hooks/useEvaluatorTypeMeta"
import EmptyComponent from "@/oss/components/Placeholders/EmptyComponent"
import {
    ApplicationReferenceLabel,
    QueryReferenceLabel,
    TestsetTag,
    TestsetTagList,
    TestsetChipList,
    VariantReferenceChip,
    VariantReferenceLabel,
    VariantReferenceText,
    VariantRevisionLabel,
} from "@/oss/components/References"
import {
    appReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
    variantReferenceAtomFamily,
} from "@/oss/components/References/atoms/entityReferences"
import useEvaluatorReference from "@/oss/components/References/hooks/useEvaluatorReference"
import {EvaluatorReferenceLabel} from "@/oss/components/References/ReferenceLabels"
import ReferenceTag, {CopyIconButton} from "@/oss/components/References/ReferenceTag"
import {
    generateAnnotationPayloadData,
    generateNewAnnotationPayloadData,
    getInitialMetricsFromAnnotations,
    transformMetadata,
} from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/transforms"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {useAppId} from "@/oss/hooks/useAppId"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {createAnnotation, updateAnnotation} from "@/oss/services/annotations/api"
import {navigationRequestAtom} from "@/oss/state/appState"
import {testcaseQueryAtomFamily} from "@/oss/state/entities/testcase"
import {workspaceMembersAtom} from "@/oss/state/workspace/atoms/selectors"

// Heavy: pull the EntityPicker / annotate stack only when a trigger opens them.
const EditEvaluationDrawer = dynamic(() => import("@/oss/components/EditEvaluationDrawer"), {
    ssr: false,
})
const Annotate = dynamic(
    () => import("@/oss/components/SharedDrawers/AnnotateDrawer/assets/Annotate"),
    {
        ssr: false,
    },
)

/** The three entity-reference resolver families, bundled to match the injected shape. */
const referenceResolver: InjectedReferenceResolver = {
    appReferenceAtomFamily,
    variantReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
}

// fn-channel registration is global + stable; do it once at module load. The annotation
// transform/service seams own heavily-`any` OSS payload shapes (see fnRegistry §11.4), so
// the structurally-compatible impls are adapted at the boundary.
registerEvalViewFns({
    formatDate24,

    createAnnotation: (payload: any) => createAnnotation(payload),

    updateAnnotation: (payload: any) =>
        updateAnnotation(payload as Parameters<typeof updateAnnotation>[0]),

    transformMetadata: (args: {data: any}) => transformMetadata(args),

    generateAnnotationPayloadData: (args: any) => generateAnnotationPayloadData(args),

    generateNewAnnotationPayloadData: (args: any) => generateNewAnnotationPayloadData(args),

    getInitialMetricsFromAnnotations: (args: any) => getInitialMetricsFromAnnotations(args),
    SimpleSharedEditor,
    evaluatorCategoryLabelMap: EVALUATOR_CATEGORY_LABEL_MAP,
})

/** Registers the run-details atom seams from their real OSS sources (reactive where needed). */
const useRegisterEvalRunDetailsInjections = () => {
    const register = useSetAtom(registerEvalRunInjections)
    const workspaceMembers = useAtomValue(workspaceMembersAtom)
    const invalidateRunsTable = useSetAtom(invalidateEvaluationRunsTableAtom)

    useEffect(() => {
        register({
            workspaceMembers,
            testcaseQueryFamily: testcaseQueryAtomFamily,
            referenceResolver,
            runInvalidate: () => invalidateRunsTable(),
            clearMetricSelection: clearMetricSelectionCache,
            annotationTransform: transformApiData,
            // The OSS navigation atom, injected by reference; the focus-drawer URL sync reads
            // it imperatively via `store.get`.
            navigationRequest:
                navigationRequestAtom as unknown as Atom<InjectedNavigationCommand | null>,
        })
    }, [register, workspaceMembers, invalidateRunsTable])
}

/** Wraps the relocated run-details view, supplying every OSS seam it depends on. */
const EvalRunDetailsViewHost = ({children}: {children: ReactNode}) => {
    useRegisterEvalRunDetailsInjections()

    const host = useMemo<EvalViewHost>(
        () => ({
            components: {
                EnhancedDrawer,
                GenericDrawer,
                CustomTreeComponent,
                EmptyComponent,
                ReferenceTag,
                CopyIconButton,
                SharedGenerationResultUtils,
                FiltersPreview,
                EvaluatorDetailsPreview,
                EvaluatorReferenceLabel,
                OSSdrillInUIProvider,
                TestsetChipList,
                VariantReferenceChip,
                Annotate,
                EditEvaluationDrawer,
                // Generic reference labels wrapped by the eval-scoped reference labels.
                GenericApplicationReferenceLabel: ApplicationReferenceLabel,
                GenericQueryReferenceLabel: QueryReferenceLabel,
                GenericTestsetTag: TestsetTag,
                GenericTestsetTagList: TestsetTagList,
                GenericVariantReferenceLabel: VariantReferenceLabel,
                GenericVariantReferenceText: VariantReferenceText,
                GenericVariantRevisionLabel: VariantRevisionLabel,
            },
            hooks: {
                useProjectPermissions,
                useAppId,
                useURL,
                useQueryParam,
                useBreadcrumbsEffect,
                useEvaluatorReference,
                useEvaluatorDetails,
                useEvaluatorTypeMeta,
                useEvaluatorTypeFromConfigs,
            },
        }),
        [],
    )

    return <EvalViewHostProvider host={host}>{children}</EvalViewHostProvider>
}

export default memo(EvalRunDetailsViewHost)
