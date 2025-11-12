import {Key, useCallback, useMemo} from "react"

import {TreeStructure, Download, Sparkle, Speedometer} from "@phosphor-icons/react"
import {Tree, TreeDataNode} from "antd"
import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {useRouter} from "next/router"

import {focusScenarioAtom} from "@/oss/components/EvalRunDetails/state/focusScenarioAtom"
import {urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import FocusDrawerSidePanelSkeleton from "../Skeletons/FocusDrawerSidePanelSkeleton"

// Helper atom to read multiple run states given a list of runIds
const evaluationsRunFamily = atomFamily(
    (runIds: string[]) =>
        atom((get) => {
            return runIds.map((runId) => get(evaluationRunStateFamily(runId)))
        }),
    deepEqual,
)

const FocusDrawerSidePanel = () => {
    const router = useRouter()
    const urlState = useAtomValue(urlStateAtom)
    const focus = useAtomValue(focusScenarioAtom)
    const compareRunIds = (urlState?.compare || []) as string[]
    const focusRunId = focus?.focusRunId!
    const focusRunState = useAtomValue(evaluationRunStateFamily(focusRunId))
    const baseRunId = useMemo(() => {
        if (focusRunState?.isBase) return focusRunId
        const routerValue = router.query?.evaluation_id
        if (Array.isArray(routerValue)) {
            return routerValue[0] ?? focusRunId
        }
        if (typeof routerValue === "string" && routerValue.length > 0) {
            return routerValue
        }
        return focusRunId
    }, [focusRunId, focusRunState?.isBase, router.query?.evaluation_id])
    const isComparison = Array.isArray(compareRunIds) && compareRunIds.length > 0
    const isBaseRun = focusRunState?.isBase ?? focusRunId === baseRunId

    // Read base run and all comparison run states
    const runIds = useMemo(() => {
        if (!isComparison) return [baseRunId]
        if (!isBaseRun && isComparison) return [focusRunId]

        return [baseRunId, ...compareRunIds]
    }, [baseRunId, compareRunIds, focusRunId, isBaseRun, isComparison])

    const runs = useAtomValue(evaluationsRunFamily(runIds))

    const baseEvaluation = useMemo(
        () => runs.find((r) => r?.enrichedRun?.id === baseRunId),
        [runs, baseRunId],
    )
    const baseEvaluators = useMemo(
        () => baseEvaluation?.enrichedRun?.evaluators || [],
        [baseEvaluation],
    )

    // Build deduped evaluator list across all runs when in comparison mode
    const dedupedEvaluators = useMemo(() => {
        if (isBaseRun && !isComparison) return baseEvaluators

        const map = new Map<string, {slug: string; name: string}>()
        runs?.forEach((r) => {
            r?.enrichedRun?.evaluators?.forEach((e) => {
                if (!map.has(e.slug)) map.set(e.slug, {slug: e.slug, name: e.name})
            })
        })
        return Array.from(map.values())
    }, [isComparison, runs, baseEvaluators, isBaseRun])

    // Output children: evaluation names (base + comparisons) when in comparison mode
    const outputChildren: TreeDataNode[] = useMemo(() => {
        if (!isComparison || (!isBaseRun && isComparison)) return []
        return runs
            .map((r) => r?.enrichedRun)
            .filter(Boolean)
            .map((enriched) => ({
                title: enriched!.name,
                key: `output-${enriched!.id}`,
                icon: <Sparkle size={14} className="text-[#13C2C2]" />,
            })) as TreeDataNode[]
    }, [isComparison, runs, isBaseRun])

    const treeData: TreeDataNode[] = useMemo(() => {
        if (!focusRunId) return []
        return [
            {
                title: "Evaluation",
                key: "evaluation",
                icon: <TreeStructure size={14} className="text-[#758391]" />,
                children: [
                    {
                        title: "Input",
                        key: "input",
                        icon: <Download size={14} className="text-[#1677FF]" />,
                    },
                    {
                        title: "Output",
                        key: "output",
                        icon: <Sparkle size={14} className="text-[#13C2C2]" />,
                        children: outputChildren,
                    },
                    {
                        title: "Evaluator",
                        key: "evaluator",
                        icon: <Speedometer size={14} className="text-[#758391]" />,
                        children:
                            dedupedEvaluators?.map((e) => ({
                                title: e.name ?? e.slug,
                                key: e.slug,
                                icon: <Speedometer size={14} className="text-[#758391]" />,
                            })) || [],
                    },
                ],
            },
        ]
    }, [dedupedEvaluators, outputChildren, focusRunId])

    const onSelect = useCallback(
        async (selectedKeys: Key[]) => {
            try {
                if (selectedKeys.length > 0) {
                    const key = selectedKeys[0].toString()
                    const currentHash = router.asPath.split("#")[1]
                    if (currentHash == key) return
                    await router.replace(
                        {
                            pathname: router.pathname,
                            query: router.query,
                            hash: key,
                        },
                        undefined,
                        {scroll: false, shallow: true},
                    )
                }
            } catch (error) {
                return ""
            }
        },
        [router],
    )

    if (!runs.length) {
        return <FocusDrawerSidePanelSkeleton />
    }

    return (
        <div className="py-2 px-2">
            <Tree
                showLine={true}
                showIcon={true}
                defaultExpandAll={true}
                onSelect={onSelect}
                treeData={treeData}
                className="[&_.ant-tree-node-content-wrapper]:!flex [&_.ant-tree-node-content-wrapper]:!items-center [&_.ant-tree-node-content-wrapper]:!gap-1 [&_.ant-tree-iconEle]:!h-[20px] [&_.ant-tree-title]:text-nowrap"
            />
        </div>
    )
}

export default FocusDrawerSidePanel
