import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Check, Plus} from "@phosphor-icons/react"
import {Button, ButtonProps, Input, Popover, PopoverProps, Typography, Tag, message} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {useLocalStorage} from "usehooks-ts"

import {useRunId} from "@/oss/contexts/RunIdContext"
import useFocusInput from "@/oss/hooks/useFocusInput"
import {EvaluationType} from "@/oss/lib/enums"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import usePreviewEvaluations from "@/oss/lib/hooks/usePreviewEvaluations"
import {EnrichedEvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"

import {urlStateAtom} from "../../../state/urlState"

const filters = ["all", "success", "failed"]
const failedFilters = ["errors", "error", "failed", "failure"]

const EvalRunCompareMenu = ({
    popoverProps,
    buttonProps,
}: {
    popoverProps?: PopoverProps
    buttonProps?: ButtonProps
}) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [filter, setFilter] = useLocalStorage("eval-compare-popup-filter", "")
    const {inputRef} = useFocusInput({isOpen: isMenuOpen})
    const router = useRouter()
    const runId = useRunId()
    // Use ref to track previous compareRunIds to avoid infinite loops
    const prevCompareRunIdsRef = useRef<string[]>([])

    // atoms
    const evaluation = useAtomValue(evaluationRunStateFamily(runId!))
    const [urlState, setUrlState] = useAtom(urlStateAtom)
    const enrichedRun = evaluation?.enrichedRun
    const compareRunIds = urlState.compare || []

    const derivedAppId = useMemo(() => {
        return enrichedRun?.appId ?? enrichedRun?.variants?.[0]?.appId ?? undefined
    }, [enrichedRun])

    const {runs: projectRuns} = usePreviewEvaluations({
        skip: false,
        types: [EvaluationType.auto_exact_match],
        appId: "",
    })

    const {runs: appRuns} = usePreviewEvaluations({
        skip: false,
        types: [EvaluationType.auto_exact_match],
        appId: derivedAppId,
    })

    const runs = (projectRuns.length ? projectRuns : appRuns) as EnrichedEvaluationRun[]

    // Track compare ids locally to avoid redundant work; do not overwrite urlState
    useEffect(() => {
        const prevIds = prevCompareRunIdsRef.current
        const currentIds = compareRunIds
        const isDifferent =
            prevIds.length !== currentIds.length ||
            prevIds.some((id, index) => id !== currentIds[index])

        if (isDifferent) {
            prevCompareRunIdsRef.current = [...compareRunIds]
        }
    }, [compareRunIds])

    const resolveTestsetIds = useCallback((run?: EnrichedEvaluationRun | null) => {
        if (!run) return new Set<string>()
        const ids = new Set<string>()
        ;(run.testsets ?? []).forEach((testset) => {
            if (testset?.id) ids.add(testset.id)
        })
        ;(run.data?.steps ?? []).forEach((step) => {
            const id = step?.references?.testset?.id
            if (id) ids.add(id)
        })
        return ids
    }, [])

    const evaluations = useMemo(() => {
        const baseIds = resolveTestsetIds(enrichedRun)
        const baseIdList = Array.from(baseIds)

        const matchedTestsetEvals = runs.filter((run) => {
            if (!baseIds.size) return false
            const runIds = resolveTestsetIds(run)
            return baseIdList.some((id) => runIds.has(id))
        })

        const evals = matchedTestsetEvals.filter((run) => run?.id !== enrichedRun?.id)

        const autoEvals = evals?.filter((run) =>
            run?.data?.steps.every(
                (step) => step?.type !== "annotation" || step?.origin === "auto",
            ),
        )

        return autoEvals
    }, [runs, enrichedRun, resolveTestsetIds])

    const filteredEvals = useMemo(() => {
        if (searchTerm.trim().length > 0) {
            return evaluations.filter((e) =>
                e?.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }

        if (filter === "success") {
            return evaluations.filter((e) => e.status === filter)
        }

        if (filter === "failed") {
            return evaluations.filter((e) => failedFilters.includes(e.status))
        }

        return evaluations
    }, [searchTerm, evaluations, filter])

    const onMutateRun = useCallback(
        async (runId: string) => {
            if (compareRunIds.includes(runId)) {
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
            } else {
                if (compareRunIds.length === 4) {
                    message.info("You can only compare up to 5 runs")
                    return
                }
                await router.replace(
                    {
                        pathname: router.pathname,
                        query: {...router.query, compare: [...compareRunIds, runId]},
                    },
                    undefined,
                    {shallow: true},
                )
                setUrlState((draft) => {
                    draft.compare = [...compareRunIds, runId]
                })
            }
        },
        [compareRunIds],
    )

    return (
        <Popover
            open={isMenuOpen}
            onOpenChange={setIsMenuOpen}
            classNames={{body: "!px-0 !py-2"}}
            trigger={["click"]}
            arrow={false}
            content={
                <section className="flex flex-col gap-2 w-[400px]">
                    <div className="flex flex-col gap-0.5 border-0 border-b border-solid border-[#EAEFF5]">
                        <div className="flex items-center gap-2 justify-between px-2">
                            <Typography.Text className="font-medium">
                                Add evaluations using testset:
                            </Typography.Text>
                            <Tag bordered={false} className="bg-[#0517290F]">
                                {enrichedRun?.testsets?.[0]?.name}
                            </Tag>
                        </div>

                        <Input
                            ref={inputRef}
                            placeholder="Search"
                            variant="borderless"
                            className="rounded-none py-2"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-1 px-3">
                        <span>Filters:</span>

                        {filters.map((f) => (
                            <Button
                                key={f}
                                size="small"
                                type={(filter || "all") === f ? "default" : "text"}
                                className="capitalize !py-0"
                                onClick={() => setFilter(f)}
                            >
                                {f}
                            </Button>
                        ))}
                    </div>

                    {filteredEvals?.length > 0 ? (
                        <div className="flex flex-col gap-0.5 px-1 max-h-[220px] overflow-y-scroll">
                            {filteredEvals?.map((evaluation) => (
                                <div
                                    key={evaluation.id}
                                    className={clsx([
                                        "flex flex-col items-center justify-between gap-1 px-2 py-1.5 rounded-md hover:bg-[#eaeff542] duration-200 cursor-pointer",
                                        {"bg-[#eaeff550]": compareRunIds.includes(evaluation.id)},
                                    ])}
                                    onClick={() => onMutateRun(evaluation.id)}
                                >
                                    <div className="w-full flex items-center justify-between">
                                        <Typography.Text
                                            className="w-[70%] truncate"
                                            title={evaluation.name}
                                        >
                                            {evaluation.name}
                                        </Typography.Text>

                                        <div className="flex items-center gap-2">
                                            <Typography.Text className="flex items-center gap-1 text-nowrap">
                                                {evaluation.variants?.[0]?.variantName || "-"}
                                                <Tag bordered={false} className="bg-[#0517290F]">
                                                    v{evaluation.variants?.[0]?.revision || "0"}
                                                </Tag>
                                            </Typography.Text>
                                            {compareRunIds?.includes(evaluation.id) ? (
                                                <Check size={14} />
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className="w-full flex items-center justify-between">
                                        <Typography.Text
                                            type="secondary"
                                            className="w-[70%] truncate"
                                        >
                                            {evaluation.description || "No description"}
                                        </Typography.Text>
                                        <Typography.Text type="secondary" className="text-nowrap">
                                            {evaluation.createdAt}
                                        </Typography.Text>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="w-full flex items-center justify-center h-[100px]">
                            <Typography.Text type="secondary">No evaluations found</Typography.Text>
                        </div>
                    )}
                </section>
            }
            {...popoverProps}
        >
            <Button icon={<Plus size={14} />} {...buttonProps}>
                Compare
            </Button>
        </Popover>
    )
}

export default memo(EvalRunCompareMenu)
