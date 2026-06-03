import {memo, ReactNode, useMemo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {workflowLatestRevisionIdAtomFamily} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {Button, Popover, Typography} from "antd"
import {useAtomValue} from "jotai"

import ReferenceTag from "@/oss/components/References/ReferenceTag"

import useEvaluatorNavigation from "../hooks/useEvaluatorNavigation"

type EvaluatorLike = Workflow | null | undefined

interface EvaluatorDetailsPopoverProps {
    evaluator: EvaluatorLike
    fallbackLabel: string
    children?: ReactNode
}

const formatDateTime = (value: string | number | Date | null | undefined) => {
    if (!value) return "—"
    try {
        return new Date(value).toLocaleString()
    } catch {
        return "—"
    }
}

const getShortId = (value?: string | null) => {
    if (!value) return "—"
    const parts = value.split("-")
    return parts.length > 1 ? parts[parts.length - 1] : value
}

const EvaluatorDetailsPopover = ({
    evaluator,
    fallbackLabel,
    children,
}: EvaluatorDetailsPopoverProps) => {
    const {buildEvaluatorTarget, navigateToEvaluator} = useEvaluatorNavigation()
    const latestRevisionId = useAtomValue(workflowLatestRevisionIdAtomFamily(evaluator?.id || ""))

    const evaluatorName = evaluator?.name || fallbackLabel
    const evaluatorId =
        (evaluator as any)?.id || (evaluator as any)?.slug || (evaluator as any)?.key
    const createdAt = (evaluator as any)?.created_at || (evaluator as any)?.createdAt
    const createdByRaw =
        (evaluator as any)?.createdBy ||
        (evaluator as any)?.created_by ||
        (evaluator as any)?.created_by_id
    const createdBy = typeof createdByRaw === "string" ? createdByRaw : ""
    const isHuman =
        Boolean((evaluator as any)?.flags?.is_feedback) ||
        Boolean((evaluator as any)?.meta?.is_feedback)

    const evaluatorWithLatestRevision = useMemo(() => {
        if (!latestRevisionId) return null
        return {...(evaluator || {}), id: latestRevisionId}
    }, [evaluator, latestRevisionId])

    const target = useMemo(() => {
        if (isHuman) {
            return buildEvaluatorTarget(evaluator)
        }
        if (!evaluatorWithLatestRevision) return null
        return buildEvaluatorTarget(evaluatorWithLatestRevision)
    }, [isHuman, buildEvaluatorTarget, evaluator, evaluatorWithLatestRevision])

    const popoverContent = (
        <div className="w-[250px]">
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                    <Typography.Text strong className="truncate">
                        {evaluatorName}
                    </Typography.Text>
                </div>
                <div className="flex flex-col gap-2 *:text-nowrap">
                    <div className="flex items-center justify-between gap-3">
                        <Typography.Text type="secondary">Evaluator ID</Typography.Text>
                        <ReferenceTag
                            label={getShortId(
                                typeof evaluatorId === "string"
                                    ? evaluatorId
                                    : String(evaluatorId || evaluatorName || ""),
                            )}
                            tooltip={
                                typeof evaluatorId === "string"
                                    ? evaluatorId
                                    : evaluatorId !== undefined && evaluatorId !== null
                                      ? String(evaluatorId)
                                      : evaluatorName
                            }
                            copyValue={
                                typeof evaluatorId === "string"
                                    ? evaluatorId
                                    : evaluatorId !== undefined && evaluatorId !== null
                                      ? String(evaluatorId)
                                      : evaluatorName
                            }
                            showIcon={false}
                            className="max-w-[180px]"
                        />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <Typography.Text type="secondary">Evaluator Type</Typography.Text>
                        <Typography.Text>
                            {" "}
                            {isHuman ? "Human evaluator" : "Automatic evaluator"}
                        </Typography.Text>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <Typography.Text type="secondary">Created at</Typography.Text>
                        <Typography.Text>{formatDateTime(createdAt)}</Typography.Text>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <Typography.Text type="secondary">Created by</Typography.Text>
                        <UserAuthorLabel name={createdBy} showAvatar />
                    </div>
                </div>
                {target ? (
                    <Button
                        type="default"
                        size="small"
                        block
                        onClick={(event) => {
                            event?.preventDefault?.()
                            event?.stopPropagation?.()
                            navigateToEvaluator(isHuman ? evaluator : evaluatorWithLatestRevision)
                        }}
                    >
                        {isHuman ? "Open evaluator registry" : "Open evaluator playground"}
                    </Button>
                ) : null}
            </div>
        </div>
    )

    return (
        <Popover mouseEnterDelay={0.2} arrow content={popoverContent} trigger="hover">
            {children || <Typography.Text>{evaluatorName}</Typography.Text>}
        </Popover>
    )
}

export default memo(EvaluatorDetailsPopover)
