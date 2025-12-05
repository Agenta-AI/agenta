import {memo, useCallback, useMemo} from "react"
import type {Key} from "react"

import {TreeStructure, Download, Sparkle, Speedometer} from "@phosphor-icons/react"
import {Skeleton, Tree, type TreeDataNode} from "antd"
import {useAtomValue} from "jotai"

import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"

import {evaluationPreviewTableStore} from "../evaluationPreviewTableStore"
import usePreviewTableData from "../hooks/usePreviewTableData"
import {previewEvalTypeAtom} from "../state/evalType"
const toSectionAnchorId = (value: string) =>
    `focus-section-${value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`

type AnchorTreeNode = TreeDataNode & {anchorId?: string}

interface FocusDrawerSidePanelProps {
    runId: string
    scenarioId: string
}

const FocusDrawerSidePanel = ({runId, scenarioId}: FocusDrawerSidePanelProps) => {
    const {columnResult} = usePreviewTableData({runId})
    const evalType = useAtomValue(previewEvalTypeAtom)

    const {rows} = useInfiniteTablePagination({
        store: evaluationPreviewTableStore,
        scopeId: runId,
        pageSize: 50,
    })

    const scenarioRow = useMemo(
        () => rows.find((r: any) => !r.__isSkeleton && r.scenarioId === scenarioId),
        [rows, scenarioId],
    )
    const scenarioIndex: number | undefined = scenarioRow?.scenarioIndex
    const scenarioBase = evalType === "human" ? "Scenario" : "Test case"
    const parentTitle = scenarioIndex
        ? `${scenarioBase} #${scenarioIndex}`
        : scenarioId
          ? `${scenarioBase} ${String(scenarioId).slice(0, 8)}…`
          : scenarioBase

    const groupAnchorMap = useMemo(() => {
        const map = new Map<string, string>()
        columnResult?.groups?.forEach((group) => {
            map.set(group.id, toSectionAnchorId(group.id))
            // Also map by kind for easier lookup (e.g., "input" -> first input group's anchor)
            if (group.kind && !map.has(group.kind)) {
                map.set(group.kind, toSectionAnchorId(group.id))
            }
        })
        return map
    }, [columnResult?.groups])

    const evaluatorNodes = useMemo<AnchorTreeNode[]>(() => {
        if (!columnResult?.evaluators?.length) return []
        return columnResult.evaluators.map((evaluator) => ({
            title: evaluator.name ?? evaluator.slug ?? "Evaluator",
            key: `evaluator:${evaluator.id ?? evaluator.slug ?? evaluator.name}`,
            icon: <Speedometer size={14} className="text-[#758391]" />,
            anchorId:
                (evaluator.id && groupAnchorMap.get(`annotation:${evaluator.id}`)) ??
                (evaluator.slug && groupAnchorMap.get(`annotation:${evaluator.slug}`)) ??
                groupAnchorMap.get("annotations"),
        }))
    }, [columnResult?.evaluators, groupAnchorMap])

    const metricNodes = useMemo<AnchorTreeNode[]>(() => {
        if (!columnResult?.groups?.length) return []
        return columnResult.groups
            .filter((group) => group.kind === "metric" && group.id !== "metrics:human")
            .map((group) => ({
                title: group.label,
                key: `metric:${group.id}`,
                icon: <Speedometer size={14} className="text-[#1677FF]" />,
                anchorId: groupAnchorMap.get(group.id) ?? toSectionAnchorId(group.id),
            }))
    }, [columnResult?.groups, groupAnchorMap])

    const treeData = useMemo<AnchorTreeNode[]>(() => {
        if (!columnResult) return []

        const children: AnchorTreeNode[] = [
            {
                title: "Input",
                key: "input",
                icon: <Download size={14} className="text-[#1677FF]" />,
                anchorId:
                    groupAnchorMap.get("inputs") ??
                    groupAnchorMap.get("input") ??
                    toSectionAnchorId("inputs"),
            },
            {
                title: "Output",
                key: "output",
                icon: <Sparkle size={14} className="text-[#13C2C2]" />,
                anchorId:
                    groupAnchorMap.get("outputs") ??
                    groupAnchorMap.get("invocation") ??
                    toSectionAnchorId("outputs"),
            },
        ]

        if (evaluatorNodes.length) {
            children.push({
                title: "Evaluator",
                key: "evaluator",
                icon: <Speedometer size={14} className="text-[#758391]" />,
                children: evaluatorNodes,
                anchorId:
                    groupAnchorMap.get("annotations") ??
                    groupAnchorMap.get("annotation") ??
                    toSectionAnchorId("annotations"),
            })
        }

        if (metricNodes.length) {
            children.push({
                title: "Metrics",
                key: "metrics",
                icon: <Speedometer size={14} className="text-[#1677FF]" />,
                children: metricNodes,
                anchorId:
                    groupAnchorMap.get("metrics:auto") ??
                    groupAnchorMap.get("metric") ??
                    toSectionAnchorId("metrics-auto"),
            })
        }

        return [
            {
                title: parentTitle,
                key: "evaluation",
                icon: <TreeStructure size={14} className="text-[#758391]" />,
                children,
            },
        ]
    }, [columnResult, parentTitle, metricNodes, evaluatorNodes])

    const handleSelect = useCallback((_selectedKeys: Key[], info: any) => {
        if (typeof window === "undefined") return
        const node = info?.node as AnchorTreeNode | undefined
        const anchorId = node?.anchorId
        if (!anchorId) return
        const target = document.getElementById(anchorId)
        if (target) {
            target.scrollIntoView({behavior: "smooth", block: "start"})
        }
    }, [])

    if (!columnResult) {
        return (
            <div className="p-4">
                <Skeleton active paragraph={{rows: 6}} />
            </div>
        )
    }

    return (
        <div className="p-4">
            <div className="rounded-xl border border-[#EAECF0] bg-white p-2">
                <Tree
                    treeData={treeData}
                    showIcon
                    defaultExpandAll
                    selectable
                    onSelect={handleSelect}
                    className="[&_.ant-tree-node-content-wrapper]:!flex [&_.ant-tree-node-content-wrapper]:!items-center [&_.ant-tree-node-content-wrapper]:!gap-1 [&_.ant-tree-node-content-wrapper]:!px-2 [&_.ant-tree]:!bg-transparent [&_.ant-tree-treenode]:!py-1 [&_.ant-tree-iconEle]:!h-[20px] [&_.ant-tree-title]:text-nowrap"
                />
            </div>
        </div>
    )
}

export default memo(FocusDrawerSidePanel)
