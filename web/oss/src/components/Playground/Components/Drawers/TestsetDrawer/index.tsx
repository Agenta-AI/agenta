import {cloneElement, isValidElement, useCallback, useMemo} from "react"

import {Database} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {TestsetTraceData} from "@/oss/components/TestsetDrawer/assets/types"
import {openDrawerAtom} from "@/oss/components/TestsetDrawer/atoms/drawerState"
import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import EnhancedButton from "../../../assets/EnhancedButton"

import {TestsetDrawerButtonProps} from "./types"

const TestsetDrawer = dynamic(() => import("@/oss/components/TestsetDrawer/TestsetDrawer"))

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
    const openDrawer = useSetAtom(openDrawerAtom)

    // Build trace data from results/hashes
    const buildTraceData = useCallback((): TestsetTraceData[] => {
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

        return traces
            .map((result, idx) => ({
                data:
                    (result?.response?.tree?.nodes?.[0]?.data as Record<string, any>) ||
                    result?.response?.data,
                key:
                    (result?.response?.tree?.nodes?.[0]?.node?.id as string) ||
                    result?.response?.span_id,
                id: idx + 1,
            }))
            .filter((result) => result.data)
    }, [resultHashes, results])

    // Count of valid result hashes (may include failed ones; see validResultsCount for success only)
    // const isResults = useMemo(() => resultHashes?.filter(Boolean)?.length, [resultHashes])
    // Count only successful results (those that have response data)
    const validResultsCount = useMemo(() => {
        // Direct results prop (rare path)
        if (results) {
            const arr = Array.isArray(results) ? results : [results]
            return arr.filter((r: any) => {
                const data =
                    (r?.response?.tree?.nodes?.[0]?.data as Record<string, any>) ||
                    r?.response?.data
                return Boolean(data)
            }).length
        }

        // Hash-based results (common path)
        const hashes = Array.isArray(resultHashes) ? resultHashes : [resultHashes]
        return hashes
            .map((h) => (h ? getResponseLazy(h) : null))
            .filter(Boolean)
            .filter((r: any) => {
                const data =
                    (r?.response?.tree?.nodes?.[0]?.data as Record<string, any>) ||
                    r?.response?.data
                return Boolean(data)
            }).length
    }, [results, resultHashes])

    // Handler to open the drawer with trace data
    const handleOpenDrawer = useCallback(() => {
        if (validResultsCount <= 0) return
        onClickTestsetDrawer?.(messageId)

        const traceData = buildTraceData()
        if (traceData.length > 0) {
            openDrawer(traceData)
        }
    }, [validResultsCount, onClickTestsetDrawer, messageId, buildTraceData, openDrawer])

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: handleOpenDrawer,
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
                    onClick={handleOpenDrawer}
                />
            )}

            <TestsetDrawer />
        </>
    )
}

export default TestsetDrawerButton
