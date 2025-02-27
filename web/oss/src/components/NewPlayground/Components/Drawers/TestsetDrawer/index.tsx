import {cloneElement, isValidElement, useMemo, useState} from "react"

import {Database} from "@phosphor-icons/react"
import {Button} from "antd"
import dynamic from "next/dynamic"

import {getResponseLazy} from "@/oss/components/NewPlayground/state"
import {TestsetTraceData} from "@/oss/components/pages/observability/drawer/TestsetDrawer/assets/types"

import {TestsetDrawerButtonProps} from "./types"
const TestsetDrawer = dynamic(
    () => import("@/oss/components/pages/observability/drawer/TestsetDrawer/TestsetDrawer"),
)

const TestsetDrawerButton = ({
    label,
    icon = true,
    children,
    resultHashes,
    ...props
}: TestsetDrawerButtonProps) => {
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useState(false)

    const testsetTraceData = useMemo(() => {
        const traceHashes = Array.isArray(resultHashes) ? resultHashes : [resultHashes]
        const traces = traceHashes
            .map((hash) => {
                return getResponseLazy(hash)
            })
            .filter((tr) => !!tr)

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
    }, [resultHashes])

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsTestsetDrawerOpen(true)
                        },
                    },
                )
            ) : (
                <Button
                    icon={icon && <Database size={14} />}
                    onClick={() => {
                        setIsTestsetDrawerOpen(true)
                    }}
                    {...props}
                >
                    {label}
                </Button>
            )}

            <TestsetDrawer
                open={isTestsetDrawerOpen}
                data={testsetTraceData as TestsetTraceData[]}
                showSelectedSpanText={false}
                onClose={() => {
                    setIsTestsetDrawerOpen(false)
                }}
            />
        </>
    )
}

export default TestsetDrawerButton
