import {useCallback, useEffect, useMemo, useState} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {clearPreviewRunsCache} from "@agenta/evaluations/hooks"
import {
    effectiveProjectIdAtom,
    evaluationRunQueryAtomFamily,
} from "@agenta/evaluations/state/evalRun"
import {invalidateEvaluationRunsTableAtom} from "@agenta/evaluations-ui"
import {getAgentaSdkClient} from "@agenta/sdk"
import {message} from "@agenta/ui/app-message"
import {PencilSimple} from "@phosphor-icons/react"
import {Button, Input, Skeleton, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {CopyIconButton, middleTruncateId} from "@/oss/components/References/ReferenceTag"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"

import {deriveRunTags} from "../utils"

import {V2Card} from "./SectionPrimitives"

const {Text} = Typography

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
            // The per-run batcher cache was removed (runs are fetched fresh-but-batched
            // through the package molecule); clear the preview LIST cache so the runs
            // table refetch below doesn't serve the stale pre-edit summary.
            clearPreviewRunsCache()
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
                <Skeleton active paragraph={{rows: 3}} title={false} />
            </V2Card>
        )
    }

    if (editing) {
        return (
            <V2Card className="gap-2.5 p-4">
                <div className="flex flex-col gap-1">
                    <Text className="text-[11px] text-colorTextTertiary">Name</Text>
                    <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={100}
                        placeholder="Run name"
                        disabled={saving}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Text className="text-[11px] text-colorTextTertiary">Description</Text>
                    <Input.TextArea
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
                        size="small"
                        onClick={() => {
                            setEditName(runName)
                            setEditDescription(runDescription)
                            setEditing(false)
                        }}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="primary"
                        size="small"
                        onClick={handleSave}
                        loading={saving}
                        disabled={!editName.trim()}
                    >
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
                <Button
                    type="text"
                    size="small"
                    icon={<PencilSimple size={13} />}
                    onClick={() => setEditing(true)}
                >
                    Edit
                </Button>
            </div>
            <Text className="text-[13.5px] font-semibold leading-[1.45]">{runName || "—"}</Text>
            {runDescription ? (
                <Text className="text-[12.5px] leading-[1.55] text-colorTextTertiary">
                    {runDescription}
                </Text>
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
