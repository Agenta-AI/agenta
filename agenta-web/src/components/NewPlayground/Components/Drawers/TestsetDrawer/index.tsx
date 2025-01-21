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
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useState(false)

    const getTestsetTraceData = useCallback(() => {
        const traces = Array.isArray(results) ? results : [results]

        if (traces.length === 0) return []
        const extractedData = traces
            ?.map((result, idx) => {
                return {
                    data: result?.response?.tree?.nodes?.[0]?.data as Record<string, any>,
                    key: result?.response?.tree?.nodes?.[0]?.node?.id as string,
                    id: idx + 1,
                }
            })
            .filter((result) => result.data)

        return extractedData
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
                    data={getTestsetTraceData() as TestsetTraceData[]}
                    showSelectedSpanText={false}
                    onClose={() => {
                        setIsTestsetDrawerOpen(false)
                    }}
                />
            )}
        </>
    )
}

export default TestsetDrawerButton
