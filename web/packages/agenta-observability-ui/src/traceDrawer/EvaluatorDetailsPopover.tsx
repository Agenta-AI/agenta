import {memo, ReactNode, useMemo} from "react"

import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {workflowLatestRevisionQueryAtomFamily} from "@agenta/entities/workflow"
import type {Workflow} from "@agenta/entities/workflow"
import {useEvaluatorNavigation} from "@agenta/observability/traceDrawer"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {getTraceDrawerReferences} from "./referenceSlots"

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
    const {ReferenceTag} = getTraceDrawerReferences()
    const {buildEvaluatorTarget} = useEvaluatorNavigation()
    const latestRevisionId =
        useAtomValue(workflowLatestRevisionQueryAtomFamily(evaluator?.id || "")).data?.id ?? null

    const evaluatorName = evaluator?.name || fallbackLabel
    // The record arrives in several shapes (workflow revision, annotation reference, raw DTO),
    // so each field is probed rather than typed to one of them.
    const e = evaluator as
        | {
              id?: string
              slug?: string
              key?: string
              created_at?: string
              createdAt?: string
              createdBy?: unknown
              created_by?: unknown
              created_by_id?: unknown
              flags?: {is_feedback?: boolean | null} | null
              meta?: {is_feedback?: boolean | null} | null
          }
        | null
        | undefined
    const evaluatorId = e?.id || e?.slug || e?.key
    const createdAt = e?.created_at || e?.createdAt
    const createdByRaw = e?.createdBy || e?.created_by || e?.created_by_id
    const createdBy = typeof createdByRaw === "string" ? createdByRaw : ""
    const isHuman = Boolean(e?.flags?.is_feedback) || Boolean(e?.meta?.is_feedback)

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
                    <span className="truncate font-medium">{evaluatorName}</span>
                </div>
                <div className="flex flex-col gap-2 *:text-nowrap">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-colorTextSecondary">Evaluator ID</span>
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
                        <span className="text-colorTextSecondary">Evaluator Type</span>
                        <span> {isHuman ? "Human evaluator" : "Automatic evaluator"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-colorTextSecondary">Created at</span>
                        <span>{formatDateTime(createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-colorTextSecondary">Created by</span>
                        <UserAuthorLabel name={createdBy} showAvatar />
                    </div>
                </div>
                {target ? (
                    <EnhancedButton
                        type="default"
                        size="small"
                        block
                        href={target.href}
                        onClick={(event) => {
                            event?.stopPropagation?.()
                        }}
                    >
                        {isHuman ? "Open evaluator registry" : "Open evaluator playground"}
                    </EnhancedButton>
                ) : null}
            </div>
        </div>
    )

    return (
        <Popover>
            {/* antd opened this on hover; Radix Popover is click-driven, and click is the
                accessible behaviour for a panel with links and buttons inside. */}
            <PopoverTrigger asChild>
                <span className="inline-flex cursor-pointer">
                    {children || <span>{evaluatorName}</span>}
                </span>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-auto max-w-[420px]">
                {popoverContent}
            </PopoverContent>
        </Popover>
    )
}

export default memo(EvaluatorDetailsPopover)
