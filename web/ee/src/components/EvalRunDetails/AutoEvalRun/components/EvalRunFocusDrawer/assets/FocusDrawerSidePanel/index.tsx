import {Key, useCallback, useMemo} from "react"
import {useRouter} from "next/router"
import {Tree, TreeDataNode} from "antd"
import {useAtomValue} from "jotai"
import {evaluationRunStateAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {TreeStructure, Download, Sparkle, Speedometer} from "@phosphor-icons/react"

const FocusDrawerSidePanel = () => {
    const router = useRouter()

    const evaluationRunState = useAtomValue(evaluationRunStateAtom)
    const evaluation = evaluationRunState?.enrichedRun
    const evaluators = evaluation?.evaluators

    const treeData: TreeDataNode[] = useMemo(() => {
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
                    },
                    {
                        title: "Evaluator",
                        key: "evaluator",
                        icon: <Speedometer size={14} className="text-[#758391]" />,
                        children:
                            evaluators?.map((e) => ({
                                title: e.name,
                                key: e.slug,
                                icon: <Speedometer size={14} className="text-[#758391]" />,
                            })) || [],
                    },
                ],
            },
        ]
    }, [evaluators])

    const onSelect = useCallback(
        async (selectedKeys: Key[]) => {
            if (selectedKeys.length > 0) {
                const key = selectedKeys[0].toString()

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
        },
        [router],
    )

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
