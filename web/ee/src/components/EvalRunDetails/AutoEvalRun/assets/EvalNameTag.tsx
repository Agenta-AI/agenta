import {useCallback, useMemo} from "react"

import {Star, XCircle} from "@phosphor-icons/react"
import {Button, Popover, PopoverProps, Tag, TagProps, Tooltip} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import UserAvatarTag from "@/oss/components/ui/UserAvatarTag"
import {EnrichedEvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"

import {urlStateAtom} from "../../state/urlState"

import TagWithLink from "./TagWithLink"
import VariantTag from "./VariantTag"
import {
    combineAppNameWithLabel,
    deriveVariantAppName,
    deriveVariantLabelParts,
    getVariantDisplayMetadata,
    normalizeId,
    prettifyVariantLabel,
} from "./variantUtils"

interface EvalNameTagProps extends TagProps {
    run: EnrichedEvaluationRun
    showClose?: boolean
    showPin?: boolean
    isBaseEval?: boolean
    onlyShowBasePin?: boolean
    popoverProps?: PopoverProps
    allowVariantNavigation?: boolean
}
const EvalNameTag = ({
    run,
    showClose = false,
    showPin = false,
    isBaseEval = false,
    onlyShowBasePin = false,
    className,
    popoverProps,
    allowVariantNavigation = true,
    ...props
}: EvalNameTagProps) => {
    const router = useRouter()
    const normalizedRouteAppId = useMemo(
        () => normalizeId(router.query.app_id as string | undefined),
        [router.query.app_id],
    )
    const [urlState, setUrlState] = useAtom(urlStateAtom)

    const onClose = useCallback(
        async (runId: string) => {
            const compareRunIds = urlState.compare || []
            const updatedRuns = compareRunIds.filter((id) => id !== runId)

            await router.replace(
                {
                    pathname: router.pathname,
                    query: {...router.query, compare: updatedRuns},
                },
                undefined,
                {shallow: true},
            )

            setUrlState((draft) => {
                draft.compare = updatedRuns.length > 0 ? updatedRuns : undefined
            })
        },
        [urlState, router, setUrlState],
    )

    const onPin = useCallback(async () => {
        const currentBaseId = router.query.evaluation_id?.toString()
        const compareRunIds = urlState.compare || []
        const targetId = run.id

        if (!currentBaseId || targetId === currentBaseId) return
        const targetIndex = compareRunIds.indexOf(targetId)
        if (targetIndex === -1) return

        const updatedCompare = [...compareRunIds]
        updatedCompare[targetIndex] = currentBaseId

        await router.replace(
            {
                pathname: router.pathname,
                query: {
                    ...router.query,
                    evaluation_id: targetId,
                    compare: updatedCompare,
                },
            },
            undefined,
            {shallow: true},
        )
        setUrlState((draft) => {
            draft.compare = updatedCompare
        })
    }, [urlState, router, run?.id, setUrlState])

    return (
        <Popover
            {...popoverProps}
            arrow
            classNames={{body: "!p-0 shrink-0 w-[280px]"}}
            mouseEnterDelay={0.3}
            content={
                <section className="w-full">
                    <div className="flex items-center justify-between p-3 border-0 border-b border-solid border-[#0517290F]">
                        <span className="w-[75%] truncate text-nowrap">{run?.name}</span>
                        <div className="flex gap-1 shrink-0">
                            {showPin && (
                                <Tooltip title={isBaseEval ? "Base eval" : "Select as base eval"}>
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<Star size={14} className="mt-[1px]" />}
                                        disabled={isBaseEval}
                                        onClick={onPin}
                                    />
                                </Tooltip>
                            )}
                            {showClose && !isBaseEval && (
                                <Tooltip title="Remove">
                                    <Button
                                        size="small"
                                        type="text"
                                        danger
                                        icon={<XCircle size={14} className="mt-[1px]" />}
                                        onClick={() => onClose(run.id)}
                                    />
                                </Tooltip>
                            )}
                        </div>
                    </div>
                    <div className="p-3 flex flex-col gap-2">
                        <div className="w-full flex items-center justify-between">
                            <span>ID</span>
                            <TooltipWithCopyAction copyText={run?.id!} title="Copy ID">
                                <Tag
                                    bordered={false}
                                    className="bg-[#0517290F] hover:bg-[#05172916]"
                                >
                                    {run?.id.split("-")[run?.id.split("-").length - 1]}
                                </Tag>
                            </TooltipWithCopyAction>
                        </div>
                        <div className="w-full flex items-center justify-between">
                            <span>Testset</span>
                            <TagWithLink
                                name={run?.testsets[0].name}
                                href={run?.testsets[0].id}
                                className="[&_span]:truncate [&_span]:max-w-[150px]"
                            />
                        </div>
                        <div className="w-full flex items-center justify-between">
                            <span>Variant</span>
                            {run?.variants && run?.variants.length > 0 ? (
                                (() => {
                                    const variant: any = run?.variants[0]
                                    const summary = getVariantDisplayMetadata(variant)
                                    const {label: formattedLabel, revision: labelRevision} =
                                        deriveVariantLabelParts({
                                            variant,
                                            displayLabel: summary.label,
                                        })
                                    const resolvedAppName =
                                        deriveVariantAppName({
                                            variant,
                                            fallbackAppName:
                                                run?.appName ||
                                                (run as any)?.app_name ||
                                                (run as any)?.app?.name,
                                        }) ?? run?.appName

                                    const prettyLabel = combineAppNameWithLabel(
                                        resolvedAppName,
                                        prettifyVariantLabel(formattedLabel) ?? formattedLabel,
                                    )

                                    const candidateRevisionId =
                                        summary.revisionId ||
                                        normalizeId(variant?.id) ||
                                        normalizeId(variant?.variantId)
                                    const candidateAppId = normalizeId(
                                        variant?.appId ||
                                            (variant as any)?.app_id ||
                                            run?.appId ||
                                            (run as any)?.app_id,
                                    )

                                    const resolvedAppId = candidateAppId || normalizedRouteAppId
                                    const blockedByRuntime =
                                        Boolean(normalizedRouteAppId) &&
                                        resolvedAppId === normalizedRouteAppId &&
                                        summary.hasRuntime === false

                                    const canNavigate =
                                        allowVariantNavigation &&
                                        Boolean(candidateRevisionId && resolvedAppId) &&
                                        summary.isHealthy !== false &&
                                        !blockedByRuntime

                                    return (
                                        <VariantTag
                                            variantName={prettyLabel}
                                            revision={labelRevision ?? variant?.revision}
                                            id={candidateRevisionId}
                                            disabled={!canNavigate}
                                            enrichedRun={run}
                                            variant={variant}
                                            className="[&_span]:truncate [&_span]:max-w-[150px]"
                                        />
                                    )
                                })()
                            ) : (
                                <Tag
                                    bordered={false}
                                    className="bg-[#0517290F] hover:bg-[#05172916]"
                                >
                                    Not available
                                </Tag>
                            )}
                        </div>
                        <div className="w-full flex items-center justify-between">
                            <span>Created on</span>
                            <span>{run?.createdAt}</span>
                        </div>
                        {!!run?.createdBy?.user?.username && (
                            <div className="w-full flex items-center justify-between">
                                <span>Created by</span>
                                <UserAvatarTag modifiedBy={run?.createdBy?.user?.username || ""} />
                            </div>
                        )}
                    </div>
                </section>
            }
        >
            <Tag className={clsx("flex items-center gap-1 w-fit", className)} {...props}>
                {showPin && (
                    <Tooltip title={isBaseEval ? "Base eval" : "Select as base eval"}>
                        <Star
                            size={12}
                            onClick={onPin}
                            className={
                                isBaseEval ? "cursor-default shrink-0" : "cursor-pointer shrink-0"
                            }
                            weight={isBaseEval ? "fill" : "regular"}
                            fillOpacity={isBaseEval ? 0.9 : 1}
                        />
                    </Tooltip>
                )}
                <span className="truncate">{run?.name}</span>
                {showClose && !isBaseEval && (
                    <Tooltip title="Remove">
                        <XCircle
                            className="cursor-pointer ml-0.5 shrink-0"
                            size={12}
                            onClick={() => onClose(run.id)}
                        />
                    </Tooltip>
                )}
            </Tag>
        </Popover>
    )
}

export default EvalNameTag
