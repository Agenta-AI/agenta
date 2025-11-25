import {useCallback, useEffect, useMemo, useState} from "react"

import {Form, Input, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import ReadOnlyBox from "@/oss/components/pages/evaluations/onlineEvaluation/components/ReadOnlyBox"
import axios from "@/oss/lib/api/assets/axiosConfig"

import {evaluationRunQueryAtomFamily} from "../../../../atoms/table/run"
import {deriveRunTags} from "../utils"
import {SectionSkeleton} from "./SectionPrimitives"

const {Text} = Typography

interface GeneralSectionProps {
    runId: string
    onRegisterActions?: (actions: {
        save: () => void
        reset: () => void
        disabled: boolean
        saving: boolean
    }) => void
}

const GeneralSection = ({runId, onRegisterActions}: GeneralSectionProps) => {
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
            await runQuery.refetch?.()
            message.success("Evaluation run updated")
        } catch (err: any) {
            message.error(err?.message || "Failed to update evaluation run")
        } finally {
            setSaving(false)
        }
    }, [editName, editDescription, runId, runQuery])

    const handleReset = useCallback(() => {
        setEditName(runData?.name ?? "")
        setEditDescription(runDescription ?? "")
    }, [runData?.name, runDescription])

    // Register header actions with parent if provided (must be before any conditional returns)
    useEffect(() => {
        onRegisterActions?.({
            save: handleSave,
            reset: handleReset,
            disabled: isSaveDisabled,
            saving,
        })
    }, [onRegisterActions, handleSave, handleReset, isSaveDisabled, saving])

    if (isLoading) {
        return <SectionSkeleton lines={4} />
    }

    return (
        <Form layout="vertical" requiredMark={false}>
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
        </Form>
    )
}

export default GeneralSection
