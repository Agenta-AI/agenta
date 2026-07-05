import {useCallback, useEffect, useMemo, useState} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {Button} from "@agenta/primitive-ui/components/button"
import {Input} from "@agenta/primitive-ui/components/input"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Textarea} from "@agenta/primitive-ui/components/textarea"
import {getAgentaSdkClient} from "@agenta/sdk"
import {message} from "@agenta/ui/app-message"
import {PencilSimple} from "@phosphor-icons/react"
import {Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {invalidateEvaluationRunsTableAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/tableStore"
import {CopyIconButton, middleTruncateId} from "@/oss/components/References/ReferenceTag"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"
import {invalidatePreviewRunCache} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunBatcher"

import {effectiveProjectIdAtom} from "../../../../atoms/run"
import {evaluationRunQueryAtomFamily} from "../../../../atoms/table/run"
import {deriveRunTags} from "../utils"

import {V2Card} from "./SectionPrimitives"

const STATUS_DOT_COLORS: Record<string, string> = {
    success: "#12B76A",
    processing: "#3B82F6",
    default: "#98A2B3",
    error: "#F04438",
    warning: "#F79009",
}

const humanizeStatus = (value: string) =>
    value.replaceAll("_", " ").replace(/(^|\s)([a-z])/g, (match) => match.toUpperCase())

const mapStatusTone = (raw: string): keyof typeof STATUS_DOT_COLORS => {
    const s = raw.toLowerCase()
    if (s.includes("success") || s.includes("completed") || s === "finished" || s === "ok")
        return "success"
    if (s.includes("fail") || s.includes("error")) return "error"
    if (
        s.includes("running") ||
        s.includes("progress") ||
        s.includes("queued") ||
        s.includes("active")
    )
        return "processing"
    if (s.includes("warn") || s.includes("partial") || s.includes("degraded")) return "warning"
    return "default"
}

/**
 * Read-first run summary card for the V2 rail. Shows status, name,
 * description, created meta, and the run ID; Edit swaps the card to the
 * name/description form (PATCH /evaluations/runs/{id}).
 */
const RunSummaryCard = ({runId}: {runId: string}) => {
    const projectId = useAtomValue(effectiveProjectIdAtom)
    const invalidateRunsTable = useSetAtom(invalidateEvaluationRunsTableAtom)
    const runQueryAtom = useMemo(() => evaluationRunQueryAtomFamily(runId), [runId])
    const runQuery = useAtomValue(runQueryAtom)
    const isLoading = runQuery.isPending && !runQuery.data

    const runData = (runQuery.data?.camelRun ?? runQuery.data?.rawRun ?? null) as Record<
        string,
        any
    > | null
    const runMeta = (runData?.meta ?? {}) as Record<string, unknown>
    const runName = typeof runData?.name === "string" ? runData.name : ""
    const runDescription =
        typeof runData?.description === "string"
            ? runData.description
            : typeof runMeta?.description === "string"
              ? (runMeta.description as string)
              : ""
    const runStatus = typeof runData?.status === "string" ? runData.status : null
    const createdAt = runData?.createdAt ?? runData?.created_at ?? null
    const createdById =
        runData?.createdById ??
        runData?.created_by_id ??
        runData?.createdBy?.id ??
        runData?.created_by?.id ??
        null

    const runTags = useMemo(
        () => deriveRunTags(runData?.tags, runMeta?.tags),
        [runData?.tags, runMeta?.tags],
    )

    const [editing, setEditing] = useState(false)
    const [editName, setEditName] = useState(runName)
    const [editDescription, setEditDescription] = useState(runDescription)
    const [saving, setSaving] = useState(false)

    // Sync the draft from the server values, but never while the user is
    // editing — a background refetch must not wipe in-progress input.
    useEffect(() => {
        if (editing) return
        setEditName(runName)
        setEditDescription(runDescription)
    }, [runName, runDescription, editing])

    const handleSave = useCallback(async () => {
        try {
            setSaving(true)
            // Partial edit: the backend updates only the fields present in the
            // payload (exclude_none), so name/description never clobber the rest.
            const client = getAgentaSdkClient({host: getAgentaApiUrl()})
            await client.evaluations.editRun(
                {
                    run_id: runId,
                    run: {id: runId, name: editName, description: editDescription},
                },
                projectId ? {queryParams: {project_id: projectId}} : undefined,
            )
            if (projectId) {
                invalidatePreviewRunCache(projectId, runId)
            }
            await runQuery.refetch?.()
            invalidateRunsTable()
            message.success("Evaluation run updated")
            setEditing(false)
        } catch (err: any) {
            message.error(err?.message || "Failed to update evaluation run")
        } finally {
            setSaving(false)
        }
    }, [editName, editDescription, runId, runQuery, projectId, invalidateRunsTable])

    if (isLoading) {
        return (
            <V2Card className="p-4">
                <div className="flex w-full flex-col gap-3">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/5" />
                </div>
            </V2Card>
        )
    }

    if (editing) {
        return (
            <V2Card className="gap-2.5 p-4">
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-colorTextTertiary">Name</span>
                    <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={100}
                        placeholder="Run name"
                        disabled={saving}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-colorTextTertiary">Description</span>
                    <Textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={3}
                        maxLength={500}
                        placeholder="Description (optional)"
                        disabled={saving}
                    />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                    <Button
                        onClick={() => {
                            setEditName(runName)
                            setEditDescription(runDescription)
                            setEditing(false)
                        }}
                        disabled={saving}
                        variant="outline"
                        size="sm"
                    >
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={!editName.trim() || saving} size="sm">
                        {saving ? <Spinner /> : null}
                        Save
                    </Button>
                </div>
            </V2Card>
        )
    }

    return (
        <V2Card className="gap-2.5 p-4">
            <div className="flex items-center justify-between gap-2">
                {runStatus ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-colorTextSecondary">
                        <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{backgroundColor: STATUS_DOT_COLORS[mapStatusTone(runStatus)]}}
                        />
                        {humanizeStatus(runStatus)}
                    </span>
                ) : (
                    <span />
                )}
                <Button onClick={() => setEditing(true)} variant="ghost" size="sm">
                    {<PencilSimple size={13} />}
                    Edit
                </Button>
            </div>
            <span className="text-[13.5px] font-semibold leading-[1.45]">{runName || "—"}</span>
            {runDescription ? (
                <span className="text-[12.5px] leading-[1.55] text-colorTextTertiary">
                    {runDescription}
                </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-colorTextTertiary">
                {createdAt ? <span>{formatDate24(createdAt)}</span> : null}
                {createdAt && createdById ? <span>·</span> : null}
                {createdById ? (
                    <span className="flex items-center gap-1">
                        by <UserAuthorLabel userId={createdById} fallback="—" />
                    </span>
                ) : null}
            </div>
            {runTags.length ? (
                <div className="flex flex-wrap gap-1">
                    {runTags.map((tag) => (
                        <Tag key={tag} className="!m-0">
                            {tag}
                        </Tag>
                    ))}
                </div>
            ) : null}
            <div className="flex items-center gap-1.5">
                <span title={runId} className="font-mono text-[11px] text-colorTextSecondary">
                    {middleTruncateId(runId)}
                </span>
                <CopyIconButton value={runId} title="Copy run ID" />
            </div>
        </V2Card>
    )
}

export default RunSummaryCard
