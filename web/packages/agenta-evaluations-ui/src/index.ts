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
