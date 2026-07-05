import {memo, ReactNode, useMemo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {workflowLatestRevisionQueryAtomFamily} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {Button} from "@agenta/primitive-ui/components/button"
import {Popover} from "antd"
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
    const {buildEvaluatorTarget} = useEvaluatorNavigation()
    const latestRevisionId =
        useAtomValue(workflowLatestRevisionQueryAtomFamily(evaluator?.id || "")).data?.id ?? null

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
                    <span className="truncate font-semibold">{evaluatorName}</span>
                </div>
                <div className="flex flex-col gap-2 *:text-nowrap">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Evaluator ID</span>
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
                        <span className="text-muted-foreground">Evaluator Type</span>
                        <span> {isHuman ? "Human evaluator" : "Automatic evaluator"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Created at</span>
                        <span>{formatDateTime(createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Created by</span>
                        <UserAuthorLabel name={createdBy} showAvatar />
                    </div>
                </div>
                {target ? (
                    <Button
                        onClick={(event) => {
                            event?.stopPropagation?.()
                        }}
                        variant="outline"
                        size="sm"
                        render={<a href={target.href} />}
                        className="w-full"
                    >
                        {isHuman ? "Open evaluator registry" : "Open evaluator playground"}
                    </Button>
                ) : null}
            </div>
        </div>
    )

    return (
        <Popover mouseEnterDelay={0.2} arrow content={popoverContent} trigger="hover">
            {children || <span>{evaluatorName}</span>}
        </Popover>
    )
}

export default memo(EvaluatorDetailsPopover)
