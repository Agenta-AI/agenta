import {type JSX} from "react"

import type {EvaluationRunTableRow} from "@agenta/evaluations/state/runsTable"
import type {ReferenceRole, ReferenceColumnDescriptor} from "@agenta/evaluations/state/runsTable"

import {useHostComponent} from "../../../../host/hostRegistry"

import type {RecordPath} from "./types"
import {createShouldCellUpdate as baseCreateShouldCellUpdate} from "./utils"

/**
 * The reference cells (App/Variant/Testset/Query/Evaluator) are OSS-owned and supplied via
 * the host registry. Resolving by name at render time (inside this thin wrapper) keeps the
 * cell renderers — which run outside React — free of the host hook while still obeying the
 * Rules of Hooks at the actual render site.
 */
const HOST_CELL_BY_ROLE: Record<ReferenceRole, string> = {
    application: "PreviewAppCell",
    variant: "PreviewVariantCell",
    testset: "PreviewTestsetCell",
    query: "PreviewQueryCell",
    evaluator: "PreviewEvaluatorCell",
}

const HostReferenceCell = ({
    role,
    record,
    descriptor,
    isVisible,
}: {
    role: ReferenceRole
    record: EvaluationRunTableRow
    descriptor: ReferenceColumnDescriptor
    isVisible: boolean
}) => {
    const Cell = useHostComponent<{
        record: EvaluationRunTableRow
        descriptor: ReferenceColumnDescriptor
        isVisible: boolean
    }>(HOST_CELL_BY_ROLE[role])
    return <Cell record={record} isVisible={isVisible} descriptor={descriptor} />
}

export const PATH_KEY: RecordPath = ["key"]
export const PATH_SKELETON: RecordPath = ["__isSkeleton"]
export const PATH_PREVIEW_ID: RecordPath = ["preview", "id"]
export const PATH_RUN_ID: RecordPath = ["runId"]
export const PATH_PROJECT_ID: RecordPath = ["projectId"]
export const PATH_APP_ID: RecordPath = ["appId"]
export const PATH_STATUS: RecordPath = ["status"]
export const PATH_CREATED_AT: RecordPath = ["createdAt"]
export const PATH_PREVIEW_META: RecordPath = ["previewMeta"]

export const REFERENCE_COLUMN_DIMENSIONS: Record<ReferenceRole, {width: number; minWidth: number}> =
    {
        application: {width: 200, minWidth: 180},
        variant: {width: 220, minWidth: 200},
        testset: {width: 200, minWidth: 180},
        query: {width: 320, minWidth: 280},
        evaluator: {width: 220, minWidth: 200},
    }

const createShouldCellUpdate = (...paths: RecordPath[]) =>
    baseCreateShouldCellUpdate(PATH_KEY, PATH_SKELETON, ...paths)

export const shouldUpdateNameCell = createShouldCellUpdate(
    PATH_PREVIEW_ID,
    PATH_RUN_ID,
    PATH_PROJECT_ID,
)
export const shouldUpdateStatusCell = createShouldCellUpdate(PATH_STATUS)
export const shouldUpdateApplicationCell = createShouldCellUpdate(
    PATH_PREVIEW_META,
    PATH_PREVIEW_ID,
    PATH_RUN_ID,
    PATH_PROJECT_ID,
    PATH_APP_ID,
)
export const shouldUpdateVariantCell = createShouldCellUpdate(
    PATH_PREVIEW_META,
    PATH_PREVIEW_ID,
    PATH_RUN_ID,
    PATH_PROJECT_ID,
)
export const shouldUpdateReferenceCell = createShouldCellUpdate(
    PATH_PREVIEW_META,
    PATH_PREVIEW_ID,
    PATH_RUN_ID,
    PATH_PROJECT_ID,
)
export const shouldUpdateEvaluatorCell = createShouldCellUpdate(
    PATH_PREVIEW_META,
    PATH_PREVIEW_ID,
    PATH_RUN_ID,
    PATH_PROJECT_ID,
)
export const shouldUpdateMetricCell = createShouldCellUpdate(
    // previewMeta (steps + mappings) drives the descriptor's per-run availability
    // (stepKeysByRunId/metricPathsByRunId). Without it, adding an evaluator whose metric
    // column ALREADY EXISTS leaves the edited run's cell stuck "unavailable": the column
    // descriptor merges in the new run, but antd reuses the old cell because the record's
    // tracked paths didn't change. The reference cells track previewMeta for the same reason.
    PATH_PREVIEW_META,
    PATH_PREVIEW_ID,
    PATH_RUN_ID,
    PATH_PROJECT_ID,
)
export const shouldUpdateCreatedAtCell = createShouldCellUpdate(PATH_CREATED_AT)
export const shouldUpdateCreatedByCell = createShouldCellUpdate(
    PATH_PREVIEW_ID,
    PATH_RUN_ID,
    PATH_PROJECT_ID,
)
export const shouldUpdateRowKeyCell = createShouldCellUpdate()

export type ReferenceCellRenderer = (
    descriptor: ReferenceColumnDescriptor,
) => (record: EvaluationRunTableRow, index: number, isVisible: boolean) => JSX.Element

export const REFERENCE_CELL_RENDERERS: Record<ReferenceRole, ReferenceCellRenderer> = {
    application: (descriptor) => (record, _idx, isVisible) => (
        <HostReferenceCell
            role="application"
            record={record}
            isVisible={isVisible}
            descriptor={descriptor}
        />
    ),
    variant: (descriptor) => (record, _idx, isVisible) => (
        <HostReferenceCell
            role="variant"
            record={record}
            isVisible={isVisible}
            descriptor={descriptor}
        />
    ),
    testset: (descriptor) => (record, _idx, isVisible) => (
        <HostReferenceCell
            role="testset"
            record={record}
            isVisible={isVisible}
            descriptor={descriptor}
        />
    ),
    query: (descriptor) => (record, _idx, isVisible) => (
        <HostReferenceCell
            role="query"
            record={record}
            isVisible={isVisible}
            descriptor={descriptor}
        />
    ),
    evaluator: (descriptor) => (record, _idx, isVisible) => (
        <HostReferenceCell
            role="evaluator"
            record={record}
            isVisible={isVisible}
            descriptor={descriptor}
        />
    ),
}
