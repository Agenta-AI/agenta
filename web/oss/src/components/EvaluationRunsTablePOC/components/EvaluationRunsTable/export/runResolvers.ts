import {useStore} from "jotai"

import {resolveRunNameForExport} from "@/oss/components/EvaluationRunsTablePOC/hooks/useEvaluationRunsColumns"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import {workspaceMemberByIdFamily} from "@/oss/state/workspace/atoms/selectors"

import {getRecordIdentifiers, logExportAction, normalizeString} from "./helpers"
import {getCamelRunFromStore, getPreviewRunSummaryFromStore} from "./store"

const resolvePreviewCreatorName = (run: any): string | null => {
    if (!run) return null
    const candidates = [
        run?.createdBy,
        run?.created_by,
        run?.createdByUser,
        run?.created_by_user,
        run?.owner,
        run?.user,
        run?.creator,
    ].filter(Boolean)
    for (const candidate of candidates) {
        const username =
            candidate?.user?.username ??
            candidate?.user?.name ??
            candidate?.user?.email ??
            candidate?.username ??
            candidate?.name ??
            candidate?.email
        const normalized = normalizeString(username)
        if (normalized) return normalized
    }
    return null
}

const resolveWorkspaceMemberName = (member: any | null | undefined) => {
    if (!member) return null
    const candidate =
        member.user?.username ?? member.user?.name ?? member.user?.email ?? member.user?.id
    return normalizeString(candidate)
}

export const resolveRunNameFromSummary = (
    store: ReturnType<typeof useStore>,
    record: EvaluationRunTableRow,
    defaultProjectId: string | null,
) => {
    const fallback = resolveRunNameForExport(record)
    const {runId, projectId} = getRecordIdentifiers(record, defaultProjectId)
    const summary = getPreviewRunSummaryFromStore(store, projectId, runId)
    const name = normalizeString(summary?.name)
    if (name) {
        logExportAction("resolved run name from summary", {
            rowKey: record.key,
            runId,
            projectId,
            name,
        })
        return name
    }
    logExportAction("run name fallback to record value", {
        rowKey: record.key,
        runId,
        projectId,
        fallback,
    })
    return fallback
}

export const resolveCreatedByExportValue = (
    store: ReturnType<typeof useStore>,
    record: EvaluationRunTableRow,
): string | undefined => {
    const runId = record.preview?.id ?? record.runId ?? null
    const projectId = record.projectId ?? null
    if (!runId) return undefined

    const camelRun = getCamelRunFromStore(store, runId)
    let summary: any = null
    if (projectId) {
        summary = getPreviewRunSummaryFromStore(store, projectId, runId)
    }

    const candidateUserId =
        summary?.createdById ??
        camelRun?.createdById ??
        camelRun?.created_by_id ??
        camelRun?.createdBy?.id ??
        camelRun?.created_by?.id ??
        camelRun?.createdByUser?.id ??
        camelRun?.created_by_user?.id ??
        null

    let memberName: string | null = null
    if (candidateUserId) {
        try {
            const memberAtom = workspaceMemberByIdFamily(candidateUserId)
            const member = store.get(memberAtom)
            memberName = resolveWorkspaceMemberName(member)
        } catch {
            memberName = null
        }
    }

    const runName = resolvePreviewCreatorName(camelRun)
    const fallbackName =
        normalizeString((record as any)?.createdBy) ??
        normalizeString((record as any)?.legacy?.created_by) ??
        normalizeString((record as any)?.legacy?.createdBy) ??
        null

    return memberName ?? runName ?? fallbackName ?? undefined
}
