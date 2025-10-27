import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Input, Tooltip, Typography} from "antd"
import Table, {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import dayjs from "dayjs"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {useTestsetInputsAnalysis} from "@/oss/components/Playground/Components/Modals/LoadTestsetModal/hooks/useTestsetInputsAnalysis"
import {
    displayedVariantsVariablesAtom,
    schemaInputKeysAtom,
} from "@/oss/components/Playground/state/atoms/variants"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {testset} from "@/oss/lib/Types"
import {fetchTestset} from "@/oss/services/testsets/api"
import {stablePromptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {useTestsetsData} from "@/oss/state/testset"
import {appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import type {SelectTestsetSectionProps} from "../types"

const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
    ssr: false,
})

const SelectTestsetSection = ({
    testSets: propsTestsets,
    selectedTestsetId,
    setSelectedTestsetId,
    handlePanelChange,
    selectedVariantRevisionIds,
    className,
    ...props
}: SelectTestsetSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const {testsets: fetchedTestSets, columnsByTestsetId} = useTestsetsData()
    const testSets = useMemo(() => {
        return propsTestsets && propsTestsets.length > 0 ? propsTestsets : fetchedTestSets || []
    }, [propsTestsets, fetchedTestSets])

    // Stable flag for whether any revision is selected
    const hasSelectedRevision = useMemo(
        () => (selectedVariantRevisionIds?.length ?? 0) > 0,
        [selectedVariantRevisionIds],
    )

    // Derive expected input variables from schema/dynamic vars (no dataset needed here)
    const appUriInfo = useAtomValue(appUriInfoAtom)
    const routePath = appUriInfo?.routePath
    const displayedVariables = useAtomValue(displayedVariantsVariablesAtom)
    const schemaInputKeys = useAtomValue(schemaInputKeysAtom)
    const selectedRevisionId = hasSelectedRevision ? selectedVariantRevisionIds[0] : undefined
    const eeDisplayedVars = useAtomValue(
        useMemo(
            () =>
                selectedRevisionId
                    ? stablePromptVariablesAtomFamily(selectedRevisionId)
                    : stablePromptVariablesAtomFamily("") /* empty, returns [] */,
            [selectedRevisionId],
        ),
    )
    const {expectedInputVariables} = useTestsetInputsAnalysis({
        routePath,
        testsetCsvData: [],
        displayedVariablesOverride: (hasSelectedRevision
            ? (eeDisplayedVars as string[])
            : (displayedVariables as string[] | undefined)) as string[] | undefined,
        schemaInputKeysOverride: schemaInputKeys as string[] | undefined,
    })

    const expectedVariables = useMemo(
        () =>
            (expectedInputVariables || [])
                .map((variable) => (typeof variable === "string" ? variable.trim() : ""))
                .filter(Boolean),
        [expectedInputVariables],
    )

    const hasExpectedVariables = expectedVariables.length > 0

    const queryClient = useQueryClient()

    useEffect(() => {
        if (!hasSelectedRevision || !hasExpectedVariables) return
        if (!Array.isArray(testSets) || testSets.length === 0) return

        const pending = testSets.filter((ts) => {
            const cols = columnsByTestsetId?.[ts._id]
            return !Array.isArray(cols) || cols.length === 0
        })

        if (!pending.length) return

        let cancelled = false
        const BATCH_SIZE = 5

        const prefetchColumns = async () => {
            for (let index = 0; index < pending.length && !cancelled; index += BATCH_SIZE) {
                const chunk = pending.slice(index, index + BATCH_SIZE)
                await Promise.all(
                    chunk.map(async (ts) => {
                        if (!ts?._id) return
                        const queryKey = ["testsetCsvData", ts._id]
                        const existing = queryClient.getQueryData(queryKey)
                        if (existing) return
                        try {
                            const csvdata = await queryClient.fetchQuery({
                                queryKey,
                                queryFn: async () => {
                                    const data = await fetchTestset(ts._id)
                                    return Array.isArray(data?.csvdata) ? data.csvdata : []
                                },
                            })
                            if (!cancelled && (!csvdata || (csvdata as any[]).length === 0)) {
                                // ensure we still notify listeners to re-run diagnostics
                                queryClient.setQueryData(queryKey, csvdata)
                            }
                        } catch {
                            // swallow errors; diagnostics will treat as unknown columns
                        }
                    }),
                )
            }
        }

        prefetchColumns()
        return () => {
            cancelled = true
        }
    }, [columnsByTestsetId, hasExpectedVariables, hasSelectedRevision, queryClient, testSets])

    // Determine disabled state and tooltip for each testset based on known columns
    const compatibilityByTestset = useMemo(() => {
        const diagnostics: Record<
            string,
            {
                columns: string[]
                columnsKnown: boolean
                missingExpected: string[]
                matched: string[]
                hasWarning: boolean
                message?: string
            }
        > = {}

        const expectedLabel = expectedVariables.join(", ")

        ;(testSets || []).forEach((ts) => {
            const cols = columnsByTestsetId?.[ts._id]
            const columnsKnown = Array.isArray(cols)
            const trimmedColumns = columnsKnown
                ? (cols as string[])
                      .map((column) => (typeof column === "string" ? column.trim() : ""))
                      .filter(Boolean)
                : []

            const columnsLower = new Set(trimmedColumns.map((column) => column.toLowerCase()))

            const missingExpected =
                columnsKnown && hasSelectedRevision && hasExpectedVariables
                    ? expectedVariables.filter(
                          (variable) => !columnsLower.has(variable.toLowerCase()),
                      )
                    : []

            const matched =
                columnsKnown && hasSelectedRevision && hasExpectedVariables
                    ? expectedVariables.filter((variable) =>
                          columnsLower.has(variable.toLowerCase()),
                      )
                    : []

            const hasWarning = missingExpected.length > 0

            let message: string | undefined

            if (hasSelectedRevision && hasExpectedVariables) {
                if (!columnsKnown) {
                    message = "Analyzing columns..."
                } else if (hasWarning) {
                    const variantList = expectedVariables.length ? expectedLabel : "—"
                    message = `The testset has no CSV columns matching the expected variables {{${variantList}}}`
                }
            }

            diagnostics[ts._id] = {
                columns: trimmedColumns,
                columnsKnown,
                missingExpected,
                matched,
                hasWarning,
                message,
            }
        })

        return diagnostics
    }, [columnsByTestsetId, hasExpectedVariables, hasSelectedRevision, expectedVariables, testSets])

    const getTestsetMessage = useCallback(
        (testsetId: string) => compatibilityByTestset[testsetId]?.message,
        [compatibilityByTestset],
    )

    const selectedTestsetMessage = useMemo(() => {
        if (!selectedTestsetId) return undefined
        return compatibilityByTestset[selectedTestsetId]?.message
    }, [compatibilityByTestset, selectedTestsetId])

    const columns: ColumnsType<testset> = useMemo(() => {
        return [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                onHeaderCell: () => ({
                    style: {minWidth: 180},
                }),
                render: (_: any, record: testset) => {
                    const message = getTestsetMessage(record._id)
                    const content = <span>{record.name}</span>
                    return message ? <Tooltip title={message}>{content}</Tooltip> : content
                },
            },
            {
                title: "Date Modified",
                dataIndex: "updated_at",
                key: "updated_at",
                onHeaderCell: () => ({
                    style: {minWidth: 180},
                }),
                render: (date: string, record: testset) => {
                    const message = getTestsetMessage(record._id)
                    const description = formatDay({date, outputFormat: "DD MMM YYYY | h:mm a"})
                    return message ? (
                        <Tooltip title={message}>
                            <span>{description}</span>
                        </Tooltip>
                    ) : (
                        description
                    )
                },
            },
            {
                title: "Date created",
                dataIndex: "created_at",
                key: "created_at",
                onHeaderCell: () => ({
                    style: {minWidth: 180},
                }),
                render: (date: string, record: testset) => {
                    const message = getTestsetMessage(record._id)
                    const description = formatDay({date, outputFormat: "DD MMM YYYY | h:mm a"})
                    return message ? (
                        <Tooltip title={message}>
                            <span>{description}</span>
                        </Tooltip>
                    ) : (
                        description
                    )
                },
            },
        ]
    }, [getTestsetMessage])

    const filteredTestset = useMemo(() => {
        let allTestsets = testSets.sort(
            (a: testset, b: testset) =>
                dayjs(b.updated_at).valueOf() - dayjs(a.updated_at).valueOf(),
        )
        if (searchTerm) {
            allTestsets = testSets.filter((item: testset) =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }
        return allTestsets
    }, [searchTerm, testSets])

    const selectedTestset = useMemo(
        () => testSets.find((testset) => testset._id === selectedTestsetId) || null,
        [selectedTestsetId, testSets],
    )

    return (
        <div className={clsx(className)} {...props}>
            <div className="flex items-start justify-between mb-2 gap-4">
                <Input.Search
                    placeholder="Search"
                    className="w-[300px] [&_input]:!py-[3.1px]"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
            <Table
                rowSelection={{
                    type: "radio",
                    columnWidth: 48,
                    selectedRowKeys: selectedTestset ? [selectedTestset._id as React.Key] : [],
                    getCheckboxProps: (record: testset) => {
                        return {
                            title: getTestsetMessage(record._id),
                        }
                    },
                    renderCell: (
                        _: any,
                        record: testset,
                        __: number,
                        originNode: React.ReactNode,
                    ) => {
                        const message = getTestsetMessage(record._id)
                        return message ? (
                            <Tooltip title={message}>
                                <span style={{display: "inline-block"}}>{originNode}</span>
                            </Tooltip>
                        ) : (
                            originNode
                        )
                    },
                    onChange: (selectedRowKeys) => {
                        setSelectedTestsetId(selectedRowKeys[0] as string)
                        handlePanelChange("evaluatorPanel")
                    },
                }}
                className={`ph-no-capture`}
                columns={columns}
                dataSource={filteredTestset}
                rowKey="_id"
                scroll={{x: "max-content", y: 455}}
                bordered
                pagination={false}
                rowClassName={(record) =>
                    clsx(
                        "cursor-pointer",
                        compatibilityByTestset[record._id]?.hasWarning && "opacity-70",
                    )
                }
                locale={{
                    emptyText: (
                        <NoResultsFound
                            className="!py-10"
                            description="No available testsets found to display"
                        />
                    ),
                }}
                onRow={(record) => {
                    const message = getTestsetMessage(record._id)
                    return {
                        title: message,
                        onClick: () => {
                            if (selectedTestset?._id === record._id) {
                                setSelectedTestsetId("")
                            } else {
                                setSelectedTestsetId(record._id)
                                handlePanelChange("evaluatorPanel")
                            }
                        },
                    }
                }}
            />
        </div>
    )
}

export default memo(SelectTestsetSection)
