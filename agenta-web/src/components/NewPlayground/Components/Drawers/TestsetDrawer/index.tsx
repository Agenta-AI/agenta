import {cloneElement, isValidElement, useCallback, useState} from "react"
import dynamic from "next/dynamic"
import {Button} from "antd"
import {Database} from "@phosphor-icons/react"
import {TestsetDrawerButtonProps} from "./types"
import {_AgentaRootsResponse} from "@/services/observability/types"
import {TestsetTraceData} from "@/components/pages/observability/drawer/TestsetDrawer/assets/types"
const TestsetDrawer = dynamic(
    () => import("@/components/pages/observability/drawer/TestsetDrawer/TestsetDrawer"),
)

const TestsetDrawerButton = ({
    label,
    icon = true,
    children,
    results,
    ...props
}: TestsetDrawerButtonProps) => {
    const [testsetDrawerData, setTestsetDrawerData] = useState<TestsetTraceData[]>([])
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useState(false)

    const getTestsetTraceData = useCallback(() => {
        if (!results) return

        const traces = Array.isArray(results) ? results : [results]

        if (!traces?.length) return []

        const extractData = traces?.map((result, idx) => {
            return {
                data: result?.response?.tree.nodes[0].data as any,
                key: result?.response?.tree.nodes[0].node.id,
                id: idx + 1,
            }
        })

        if (extractData.length > 0) {
            setIsTestsetDrawerOpen(true)
            setTestsetDrawerData(extractData as TestsetTraceData[])
        }
    }, [results])

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            getTestsetTraceData()
                        },
                    },
                )
            ) : (
                <Button
                    icon={icon && <Database size={14} />}
                    onClick={() => getTestsetTraceData()}
                    {...props}
                >
                    {label}
                </Button>
            )}

            {isTestsetDrawerOpen && (
                <TestsetDrawer
                    open={isTestsetDrawerOpen}
                    data={testsetDrawerData}
                    onClose={() => {
                        setIsTestsetDrawerOpen(false)
                        setTestsetDrawerData([])
                    }}
                />
            )}
        </>
    )
}

export default TestsetDrawerButton
