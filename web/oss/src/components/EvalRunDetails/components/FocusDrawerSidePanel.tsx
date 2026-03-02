import {memo, useCallback, useMemo, useState} from "react"
import type {ReactNode} from "react"

import {TreeStructure, Download, Sparkle, Speedometer} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import CustomTreeComponent from "@/oss/components/CustomUIs/CustomTreeComponent"
import {useInfiniteTablePagination} from "@/oss/components/InfiniteVirtualTable"

import {evaluationPreviewTableStore} from "../evaluationPreviewTableStore"
import usePreviewTableData from "../hooks/usePreviewTableData"
import {previewEvalTypeAtom} from "../state/evalType"
const toSectionAnchorId = (value: string) =>
    `focus-section-${value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`

interface FocusTreeNode {
    id: string
    title: string
    icon?: ReactNode
    anchorId?: string
    children?: FocusTreeNode[]
    expanded?: boolean
}

interface FocusDrawerSidePanelProps {
    runId: string
    scenarioId: string
}

const FocusDrawerSidePanel = ({runId, scenarioId}: FocusDrawerSidePanelProps) => {
    const {columnResult} = usePreviewTableData({runId})
    const evalType = useAtomValue(previewEvalTypeAtom)
    const [selectedKey, setSelectedKey] = useState<string | null>(null)

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

    const evaluatorNodes = useMemo<FocusTreeNode[]>(() => {
        if (!columnResult?.evaluators?.length) return []
        return columnResult.evaluators.map((evaluator) => ({
            title: evaluator.name ?? evaluator.slug ?? "Evaluator",
            id: `evaluator:${evaluator.id ?? evaluator.slug ?? evaluator.name}`,
            icon: <Speedometer size={14} className="text-[#758391]" />,
            anchorId:
                (evaluator.id && groupAnchorMap.get(`annotation:${evaluator.id}`)) ??
                (evaluator.slug && groupAnchorMap.get(`annotation:${evaluator.slug}`)) ??
                groupAnchorMap.get("annotations"),
        }))
    }, [columnResult?.evaluators, groupAnchorMap])

    const treeData = useMemo<FocusTreeNode | null>(() => {
        if (!columnResult) return null

        const children: FocusTreeNode[] = [
            {
                title: "Input",
                id: "input",
                icon: <Download size={14} className="text-[#1677FF]" />,
                anchorId:
                    groupAnchorMap.get("inputs") ??
                    groupAnchorMap.get("input") ??
                    toSectionAnchorId("inputs"),
            },
            {
                title: "Output",
                id: "output",
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
                id: "evaluator",
                icon: <Speedometer size={14} className="text-[#758391]" />,
                children: evaluatorNodes,
                anchorId:
                    groupAnchorMap.get("annotations") ??
                    groupAnchorMap.get("annotation") ??
                    toSectionAnchorId("annotations"),
            })
        }

        return {
            title: parentTitle,
            id: "evaluation",
            icon: <TreeStructure size={14} className="text-[#758391]" />,
            children,
            expanded: true,
        }
    }, [columnResult, evaluatorNodes, groupAnchorMap, parentTitle])

    const handleSelect = useCallback((key: string, node: FocusTreeNode) => {
        if (typeof window === "undefined") return
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

    return treeData ? (
        <CustomTreeComponent
            data={treeData}
            getKey={(node) => node.id}
            getChildren={(node) => node.children}
            renderLabel={(node) => (
                <div className="flex items-center gap-2 text-xs text-[#344054]">
                    {node.icon}
                    <span className="truncate">{node.title}</span>
                </div>
            )}
            selectedKey={selectedKey}
            onSelect={(key, node) => {
                setSelectedKey(key)
                handleSelect(key, node)
            }}
            defaultExpanded
        />
    ) : null
}

export default memo(FocusDrawerSidePanel)
