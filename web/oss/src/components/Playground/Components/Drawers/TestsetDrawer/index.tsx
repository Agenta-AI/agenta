import {cloneElement, isValidElement, useMemo, useState} from "react"

import {Database} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import {TestsetTraceData} from "@/oss/components/pages/observability/drawer/TestsetDrawer/assets/types"
import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import EnhancedButton from "../../../assets/EnhancedButton"

import {TestsetDrawerButtonProps} from "./types"

const TestsetDrawer = dynamic(
    () => import("@/oss/components/pages/observability/drawer/TestsetDrawer/TestsetDrawer"),
)

const TestsetDrawerButton = ({
    label,
    icon = true,
    children,
    resultHashes,
    results,
    onClickTestsetDrawer,
    messageId,
    ...props
}: TestsetDrawerButtonProps) => {
    const [isTestsetDrawerOpen, setIsTestsetDrawerOpen] = useState(false)

    let traces: (Record<string, any> | null | undefined)[] = []
    const testsetTraceData = useMemo(() => {
        if (!isTestsetDrawerOpen) return []

        if (results) {
            traces = Array.isArray(results) ? results : [results]
        } else if (resultHashes) {
            const traceHashes = Array.isArray(resultHashes) ? resultHashes : [resultHashes]
            traces = traceHashes
                .map((hash) => {
                    return hash ? getResponseLazy(hash) : undefined
                })
                .filter((tr) => !!tr)
        }

        if (traces.length === 0) return []
        const extractedData = traces
            ?.map((result, idx) => {
                return {
                    data:
                        (result?.response?.tree?.nodes?.[0]?.data as Record<string, any>) ||
                        result?.response?.data,
                    key:
                        (result?.response?.tree?.nodes?.[0]?.node?.id as string) ||
                        result?.response?.span_id,
                    id: idx + 1,
                }
            })
            .filter((result) => result.data)

        return extractedData
    }, [resultHashes, results, isTestsetDrawerOpen])

    const isResults = useMemo(() => resultHashes?.filter(Boolean)?.length, [resultHashes])

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            if (!isResults) return
                            onClickTestsetDrawer?.(messageId)
                            setIsTestsetDrawerOpen(true)
                        },
                    },
                )
            ) : (
                <EnhancedButton
                    {...props}
                    label={label}
                    icon={icon && <Database size={14} />}
                    disabled={!isResults || props.disabled}
                    tooltipProps={{
                        title: !isResults ? "Run tests before adding to test set" : "",
                    }}
                    onClick={() => {
                        onClickTestsetDrawer?.(messageId)
                        setIsTestsetDrawerOpen(true)
                    }}
                />
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
