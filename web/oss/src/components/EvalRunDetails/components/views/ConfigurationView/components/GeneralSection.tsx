import {useCallback, useEffect, useMemo, useState} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Button, Form, Input, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {invalidateEvaluationRunsTableAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/tableStore"
import ReadOnlyBox from "@/oss/components/pages/evaluations/onlineEvaluation/components/ReadOnlyBox"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {invalidatePreviewRunCache} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunBatcher"

import {effectiveProjectIdAtom} from "../../../../atoms/run"
import {evaluationRunQueryAtomFamily} from "../../../../atoms/table/run"
import {deriveRunTags} from "../utils"

import {SectionHeaderRow, SectionSkeleton} from "./SectionPrimitives"

const {Text} = Typography

interface GeneralSectionProps {
    runId: string
    showActions?: boolean
}

const GeneralSectionHeader = ({runId, index}: {runId: string; index: number}) => {
    return (
        <div className="flex flex-col gap-1">
            <Text className="text-sm font-semibold text-[#344054]">General</Text>
        </div>
    )
}

const GeneralSection = ({runId, showActions = true}: GeneralSectionProps) => {
    const [collapsed, setCollapsed] = useState(false)
    const projectId = useAtomValue(effectiveProjectIdAtom)
    const invalidateRunsTable = useSetAtom(invalidateEvaluationRunsTableAtom)
    const runQueryAtom = useMemo(() => evaluationRunQueryAtomFamily(runId), [runId])
    const runQuery = useAtomValue(runQueryAtom)
    const isLoading = runQuery.isPending && !runQuery.data

    const runData = runQuery.data?.camelRun ?? runQuery.data?.rawRun ?? null
    const runMeta = (runData?.meta ?? {}) as Record<string, unknown>
    const runSlug =
        typeof runData?.slug === "string"
            ? runData.slug
            : typeof runMeta?.slug === "string"
              ? (runMeta.slug as string)
              : null
    const runDescription =
        typeof runData?.description === "string"
            ? runData.description
            : typeof runMeta?.description === "string"
              ? (runMeta.description as string)
              : null
    const runTags = useMemo(
        () => deriveRunTags(runData?.tags, runMeta?.tags),
        [runData?.tags, runMeta?.tags],
    )

    const [editName, setEditName] = useState<string>(runData?.name ?? "")
    const [editDescription, setEditDescription] = useState<string>(runDescription ?? "")
    const [saving, setSaving] = useState(false)

    // Sync local state when query data changes
    useEffect(() => {
        setEditName(runData?.name ?? "")
        setEditDescription(runDescription ?? "")
    }, [runData?.name, runDescription])

    const isSaveDisabled = useMemo(() => {
        const trimmedName = (editName || "").trim()
        const sameName = trimmedName === (runData?.name || "").trim()
        const sameDesc = (editDescription || "").trim() === (runDescription || "").trim()
        return saving || !trimmedName || (sameName && sameDesc)
    }, [editName, editDescription, runData?.name, runDescription, saving])

    const handleSave = useCallback(async () => {
        try {
            setSaving(true)
            const base = (runQuery.data?.rawRun ?? runQuery.data?.camelRun ?? {}) as Record<
                string,
                any
            >
            await axios.patch(`/preview/evaluations/runs/${runId}`, {
                run: {
                    ...base,
                    id: runId,
                    name: editName,
                    description: editDescription,
                },
            })
            // Invalidate the cache before refetching to ensure fresh data
            if (projectId) {
                invalidatePreviewRunCache(projectId, runId)
            }
            await runQuery.refetch?.()
            // Also invalidate the runs table so it shows updated data when user navigates back
            invalidateRunsTable()
            message.success("Evaluation run updated")
        } catch (err: any) {
            message.error(err?.message || "Failed to update evaluation run")
        } finally {
            setSaving(false)
        }
    }, [editName, editDescription, runId, runQuery, projectId, invalidateRunsTable])

    const handleReset = useCallback(() => {
        setEditName(runData?.name ?? "")
        setEditDescription(runDescription ?? "")
    }, [runData?.name, runDescription])

    if (isLoading) {
        return <SectionSkeleton lines={4} />
    }

    return (
        <Form layout="vertical" requiredMark={false}>
            <SectionHeaderRow
                left={<GeneralSectionHeader runId={runId} />}
                right={
                    <Button
                        type="text"
                        size="small"
                        icon={<DownOutlined rotate={collapsed ? -90 : 0} style={{fontSize: 12}} />}
                        onClick={() => setCollapsed((v) => !v)}
                    />
                }
            />
            {!collapsed ? (
                <div className="flex flex-col mt-1 gap-1">
                    <Form.Item label="Name" style={{marginBottom: 12}}>
                        <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            maxLength={100}
                            placeholder="Run name"
                            disabled={isLoading || saving}
                        />
                        {runSlug ? <Text type="secondary">Slug: {runSlug}</Text> : null}
                    </Form.Item>
                    <Form.Item label="Description" style={{marginBottom: 12}}>
                        <Input.TextArea
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            rows={3}
                            maxLength={500}
                            placeholder="Description (optional)"
                            disabled={isLoading || saving}
                        />
                    </Form.Item>
                    <Form.Item label="Tags" style={{marginBottom: 0}}>
                        {runTags.length ? (
                            <ReadOnlyBox>
                                <div className="flex flex-wrap gap-1">
                                    {runTags.map((tag) => (
                                        <Tag key={tag} className="!m-0">
                                            {tag}
                                        </Tag>
                                    ))}
                                </div>
                            </ReadOnlyBox>
                        ) : (
                            <Text type="secondary">No tags</Text>
                        )}
                    </Form.Item>
                    {showActions ? (
                        <div className="flex justify-end gap-2 pt-2">
                            <Button onClick={handleReset} disabled={saving || isSaveDisabled}>
                                Reset
                            </Button>
                            <Button
                                type="primary"
                                onClick={handleSave}
                                loading={saving}
                                disabled={isSaveDisabled}
                            >
                                Save
                            </Button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </Form>
    )
}

export default GeneralSection
