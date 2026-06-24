/**
 * @agenta/evaluations-ui
 *
 * React UI for evaluations — the run list table, run detail view, scenario table, and
 * metric cells. Mirrors the @agenta/annotation-ui split: headless logic in
 * @agenta/evaluations, React here. Built on the @agenta/entities molecules.
 *
 * Scaffold only (WP-0). Components are moved in here from @agenta/annotation-ui /
 * OSS in later work packages — see docs/designs/evaluations-packages-migration-plan.md.
 *
 * @packageDocumentation
 */

export {default as EvaluationListView} from "./components/EvaluationListView"
export type {EvaluationListViewProps} from "./components/EvaluationListView"

export {default as CreatedByCell} from "./components/cells/CreatedByCell"
export {default as QueueProgressCell} from "./components/cells/QueueProgressCell"
export {default as EvaluatorNamesCell} from "./components/cells/EvaluatorNamesCell"
export {default as AssignmentsCell} from "./components/cells/AssignmentsCell"

// ── eval-run scenario-table ETL UI ────────────────────────────────────────────
export {default as EtlColumnHeader} from "./components/etl/EtlColumnHeader"
export {default as ScenarioFilterBar} from "./components/etl/ScenarioFilterBar"
export type {ScenarioFilterBarProps} from "./components/etl/ScenarioFilterBar"
export {default as EtlResolvedCell, EtlSkeletonCell} from "./components/etl/cells/EtlResolvedCell"
export type {EtlResolvedCellProps} from "./components/etl/cells/EtlResolvedCell"
export {useEtlColumns} from "./components/etl/useEtlColumns"
export type {UseEtlColumnsArgs} from "./components/etl/useEtlColumns"

// ── metric detail popover + charts ────────────────────────────────────────────
export {default as MetricDetailsPreviewPopover} from "./components/MetricDetails/MetricDetailsPreviewPopover"
export {
    ResponsiveFrequencyChart,
    ResponsiveMetricChart,
    buildChartData,
    format3Sig,
    formatMetricValue,
    METRIC_FORMATTERS,
} from "./components/MetricDetails/MetricDetailsPopover"
export type {ChartDatum, MetricFormatter} from "./components/MetricDetails/MetricDetailsPopover"

// ── eval-view host registry (component/hook injection seam — WP-4h, §12.1c) ────
export {
    EvalViewHostProvider,
    useEvalViewHost,
    useHostComponent,
    useHostHook,
} from "./host/hostRegistry"
export type {EvalViewHost, HostHook} from "./host/hostRegistry"
export {registerEvalViewFns, getEvalViewFns} from "./host/fnRegistry"
export type {EvalViewFns, EvalViewUrlState, WaitForUrlOptions} from "./host/fnRegistry"

// ── run-view injection seams (atom channel — relocated from @agenta/evaluations/state) ──
export * from "./host/runViewInjection"

// ── eval run-list view (relocated from OSS EvaluationRunsTablePOC — WP-4h-4) ────
export {
    EvaluationRunsTable,
    EvaluationRunsTablePOC,
    LatestEvaluationRunsTable,
    EvaluationRunsTableStoreProvider,
    EvaluationRunsCreateButton,
    evaluationRunsTableContextSetterAtom,
    evaluationRunsTableOverridesAtom,
    evaluationRunsTypeFiltersAtom,
    type EvaluationRunsTableOverrides,
} from "./components/RunsTable"
export {invalidateEvaluationRunsTableAtom} from "./components/RunsTable/atoms/tableStore"

// ── eval run-details view (relocated from OSS EvalRunDetails — WP-4h-5) ─────────
export {default as EvalRunDetailsPage} from "./components/RunDetails/components/Page"
export {default as EvalRunFocusDrawerMount} from "./components/RunDetails/components/EvalRunFocusDrawerMount"
// Annotation field renderer (consumed by the OSS AnnotateDrawer collapse content).
export {AnnotationFieldRenderer} from "./components/RunDetails/components/views/SingleScenarioViewerPOC/ScenarioAnnotationPanel/AnnotationInputs"
// Config-view windowing/sampling formatters (consumed by the OSS QueryCells reference cell).
export {
    formatSamplingRate,
    formatWindowRange,
} from "./components/RunDetails/components/views/ConfigurationView/utils"
// Focus-drawer URL-sync atoms (consumed by the OSS focus-drawer URL state module).
export {
    openFocusDrawerAtom,
    focusDrawerAtom,
    resetFocusDrawerAtom,
    setFocusDrawerTargetAtom,
} from "./components/RunDetails/state/focusDrawerAtom"
// Global annotate-drawer state atom (relocated here; consumed by the run-details view).
export {virtualScenarioTableAnnotateDrawerAtom} from "./components/RunDetails/state/virtualScenarioTableAnnotateDrawer"
