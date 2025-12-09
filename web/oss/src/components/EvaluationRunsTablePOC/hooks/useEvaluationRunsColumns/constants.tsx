import {type JSX} from "react"

import {PreviewAppCell} from "@/oss/components/References/cells/ApplicationCells"
import {PreviewEvaluatorCell} from "@/oss/components/References/cells/EvaluatorCells"
import {PreviewQueryCell} from "@/oss/components/References/cells/QueryCells"
import {PreviewTestsetCell} from "@/oss/components/References/cells/TestsetCells"
import {PreviewVariantCell} from "@/oss/components/References/cells/VariantCells"

import type {EvaluationRunTableRow} from "../../types"
import type {ReferenceRole, ReferenceColumnDescriptor} from "../../utils/referenceSchema"

import type {RecordPath} from "./types"
import {createShouldCellUpdate as baseCreateShouldCellUpdate} from "./utils"

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
        <PreviewAppCell record={record} isVisible={isVisible} descriptor={descriptor} />
    ),
    variant: (descriptor) => (record, _idx, isVisible) => (
        <PreviewVariantCell record={record} isVisible={isVisible} descriptor={descriptor} />
    ),
    testset: (descriptor) => (record, _idx, isVisible) => (
        <PreviewTestsetCell record={record} isVisible={isVisible} descriptor={descriptor} />
    ),
    query: (descriptor) => (record, _idx, isVisible) => (
        <PreviewQueryCell record={record} isVisible={isVisible} descriptor={descriptor} />
    ),
    evaluator: (descriptor) => (record, _idx, isVisible) => (
        <PreviewEvaluatorCell record={record} isVisible={isVisible} descriptor={descriptor} />
    ),
}
