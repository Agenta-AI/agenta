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
    console.log("results", results)
    const getTestsetTraceData = useCallback(() => {
        const traces = Array.isArray(results) ? results : [results]

        if (traces.length === 0) {
            setTestsetDrawerData([])
            return
        }
        console.log("traces", traces)
        const extractData = traces
            ?.map((result, idx) => {
                return {
                    data: result?.response?.tree?.nodes?.[0]?.data as Record<string, any>,
                    key: result?.response?.tree?.nodes?.[0]?.node?.id as string,
                    id: idx + 1,
                }
            })
            .filter((result) => result.data)

        console.log("extractData", extractData)
        if (extractData.length > 0) {
            setTestsetDrawerData(extractData)
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
                            setIsTestsetDrawerOpen(true)
                        },
                    },
                )
            ) : (
                <Button
                    icon={icon && <Database size={14} />}
                    onClick={() => {
                        getTestsetTraceData()
                        setIsTestsetDrawerOpen(true)
                    }}
                    {...props}
                >
                    {label}
                </Button>
            )}

            {isTestsetDrawerOpen && (
                <TestsetDrawer
                    open={isTestsetDrawerOpen}
                    data={testsetDrawerData}
                    showSelectedSpanText={false}
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
