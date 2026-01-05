import {cloneElement, isValidElement, useMemo, useState} from "react"

import {Database} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import EnhancedButton from "../../../../EnhancedUIs/Button"

import {TestsetDrawerButtonProps} from "./types"

const TestsetDrawer = dynamic(
    () => import("@/oss/components/SharedDrawers/AddToTestsetDrawer/TestsetDrawer"),
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

    // Extract span IDs from results - entity atoms will fetch the actual data
    const spanIds = useMemo(() => {
        if (!isTestsetDrawerOpen) return []

        let traces: (Record<string, any> | null | undefined)[] = []
        if (results) {
            traces = Array.isArray(results) ? results : [results]
        } else if (resultHashes) {
            const traceHashes = Array.isArray(resultHashes) ? resultHashes : [resultHashes]
            traces = traceHashes
                .map((hash) => (hash ? getResponseLazy(hash) : undefined))
                .filter((tr) => !!tr)
        }

        if (traces.length === 0) return []

        // Extract only span IDs - let entity atoms fetch the data
        return traces
            .map((result) => {
                // Use span_id (hex format) not node.id (UUID format)
                const spanId =
                    (result?.response?.tree?.nodes?.[0]?.span_id as string) ||
                    result?.response?.span_id
                // Validate that the span has data (successful generation)
                const hasData = result?.response?.tree?.nodes?.[0]?.data || result?.response?.data
                return hasData ? spanId : null
            })
            .filter((id): id is string => !!id)
    }, [resultHashes, results, isTestsetDrawerOpen])

    // Count only successful results (those that have response data)
    // We count eagerly (before drawer opens) for button disabled state
    const validResultsCount = useMemo(() => {
        let traces: (Record<string, any> | null | undefined)[] = []

        if (results) {
            traces = Array.isArray(results) ? results : [results]
        } else if (resultHashes) {
            const hashes = Array.isArray(resultHashes) ? resultHashes : [resultHashes]
            traces = hashes.map((h) => (h ? getResponseLazy(h) : null)).filter(Boolean)
        }

        return traces.filter((r: any) => {
            const data =
                (r?.response?.tree?.nodes?.[0]?.data as Record<string, any>) || r?.response?.data
            return Boolean(data)
        }).length
    }, [results, resultHashes])

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            if (validResultsCount <= 0) return
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
                    // Enable only when there is at least one successful generation
                    disabled={validResultsCount <= 0 || props.disabled}
                    tooltipProps={{
                        title: validResultsCount <= 0 ? "No successful generations to add" : "",
                    }}
                    onClick={() => {
                        onClickTestsetDrawer?.(messageId)
                        setIsTestsetDrawerOpen(true)
                    }}
                />
            )}

            <TestsetDrawer
                open={isTestsetDrawerOpen}
                spanIds={spanIds}
                showSelectedSpanText={false}
                onClose={() => {
                    setIsTestsetDrawerOpen(false)
                }}
            />
        </>
    )
}

export default TestsetDrawerButton
