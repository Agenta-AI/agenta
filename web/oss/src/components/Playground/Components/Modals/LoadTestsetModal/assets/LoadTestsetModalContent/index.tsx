import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Checkbox, Divider, Input, Menu, Tooltip, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {Expandable} from "@/oss/components/Tables/ExpandableCell"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {Testset, testset} from "@/oss/lib/Types"
import {fetchTestset} from "@/oss/services/testsets/api"
import {useTestsetsData} from "@/oss/state/testset"
import {urlAtom} from "@/oss/state/url"
import {appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {useTestsetInputsAnalysis} from "../../hooks/useTestsetInputsAnalysis"
import {LoadTestsetModalContentProps} from "../types"

const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {
        ssr: false,
    },
)

const LoadTestsetModalContent = ({
    modalProps,
    selectedTestset,
    setSelectedTestset,
    testsetCsvData,
    selectedRowKeys,
    setSelectedRowKeys,
    isLoadingTestset,
    isChat,
}: LoadTestsetModalContentProps) => {
    const {testsets, columnsByTestsetId, isLoading} = useTestsetsData({enabled: modalProps.open})
    const queryClient = useQueryClient()
    const router = useRouter()

    const [searchTerm, setSearchTerm] = useState("")
    const appUriInfo = useAtomValue(appUriInfoAtom)
    const routePath = appUriInfo?.routePath
    const urlState = useAtomValue(urlAtom)

    // High-level analysis of inputs vs testset columns, including schema + dynamic variables
    const {expectedInputVariables, hasCompatibilityIssue} = useTestsetInputsAnalysis({
        routePath,
        testsetCsvData,
    })

    const normalizedExpectedVariables = useMemo(
        () =>
            expectedInputVariables
                .map((variable) => (typeof variable === "string" ? variable.trim() : ""))
                .filter(Boolean),
        [expectedInputVariables],
    )

    const testsetMatchInfo = useMemo(() => {
        return testsets.reduce(
            (acc, ts) => {
                const id = ts?._id
                if (!id) return acc

                const columns = columnsByTestsetId?.[id]
                if (!Array.isArray(columns) || columns.length === 0) {
                    acc[id] = {score: 0, hasColumns: false}
                    return acc
                }

                const normalizedColumns = new Set(
                    columns
                        .map((column) => (typeof column === "string" ? column.trim() : undefined))
                        .filter(Boolean) as string[],
                )

                if (normalizedColumns.size === 0) {
                    acc[id] = {score: 0, hasColumns: false}
                    return acc
                }

                const score = normalizedExpectedVariables.reduce((count, variable) => {
                    if (!variable) return count
                    return normalizedColumns.has(variable) ? count + 1 : count
                }, 0)

                acc[id] = {score, hasColumns: true}
                return acc
            },
            {} as Record<string, {score: number; hasColumns: boolean}>,
        )
    }, [columnsByTestsetId, normalizedExpectedVariables, testsets])

    const compatibilityByTestset = useMemo(() => {
        return testsets.reduce(
            (acc, ts) => {
                const id = ts?._id
                if (!id) return acc

                const rawColumns = columnsByTestsetId?.[id]
                const columnsKnown = Array.isArray(rawColumns)
                const trimmedColumns = columnsKnown
                    ? (rawColumns as string[])
                          .map((column) => (typeof column === "string" ? column.trim() : ""))
                          .filter(Boolean)
                    : []
                const columnsLower = new Set(trimmedColumns.map((column) => column.toLowerCase()))

                const missingExpected = columnsKnown
                    ? normalizedExpectedVariables.filter(
                          (variable) => !columnsLower.has(variable.toLowerCase()),
                      )
                    : []

                const matched = columnsKnown
                    ? normalizedExpectedVariables.filter((variable) =>
                          columnsLower.has(variable.toLowerCase()),
                      )
                    : []

                acc[id] = {
                    columns: trimmedColumns,
                    missingExpected,
                    matched,
                    columnsKnown,
                    hasWarning: columnsKnown && missingExpected.length > 0,
                }

                return acc
            },
            {} as Record<
                string,
                {
                    columns: string[]
                    missingExpected: string[]
                    matched: string[]
                    columnsKnown: boolean
                    hasWarning: boolean
                }
            >,
        )
    }, [columnsByTestsetId, normalizedExpectedVariables, testsets])

    const bestMatchingTestset = useMemo(() => {
        if (!testsets.length) return {id: "", score: -1}

        if (normalizedExpectedVariables.length === 0) {
            const firstId = testsets[0]?._id || ""
            return {id: firstId, score: 0}
        }

        let bestId = ""
        let bestScore = 0

        testsets.forEach((ts) => {
            const id = ts?._id
            if (!id) return
            const info = testsetMatchInfo[id]
            if (!info?.hasColumns) return
            if (info.score > bestScore) {
                bestScore = info.score
                bestId = id
            }
        })

        if (bestScore > 0 && bestId) {
            return {id: bestId, score: bestScore}
        }

        return {id: "", score: 0}
    }, [normalizedExpectedVariables.length, testsetMatchInfo, testsets])

    const {id: bestMatchingTestsetId, score: _bestMatchingScore} = bestMatchingTestset

    const handleCreateTestset = useCallback(() => {
        router.push(`${urlState.projectURL}/testsets`)
    }, [router, urlState?.projectURL])

    useEffect(() => {
        if (!modalProps.open || !testsets.length) return

        setSelectedTestset((prev) => {
            const prevExists = prev && testsets.some((ts) => ts?._id === prev)
            if (prevExists) {
                return prev
            }

            if (!normalizedExpectedVariables.length) {
                return testsets[0]?._id || ""
            }

            return bestMatchingTestsetId || testsets[0]?._id || ""
        })
    }, [bestMatchingTestsetId, modalProps.open, normalizedExpectedVariables.length, testsets])

    const filteredTestset = useMemo(() => {
        if (!searchTerm) return testsets
        return testsets.filter((item: testset) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, testsets])

    // Prefetch CSV data for the first N visible testsets to populate column cache
    useEffect(() => {
        if (!modalProps.open) return

        const BATCH = 8
        const list = (filteredTestset.length ? filteredTestset : testsets).slice(0, BATCH)
        list.forEach((ts: any) => {
            if (!ts?._id) return
            queryClient.prefetchQuery({
                queryKey: ["testsetCsvData", ts._id],
                queryFn: async () => {
                    const data = await fetchTestset(ts._id)
                    return data.csvdata ?? []
                },
                staleTime: 1000 * 60 * 2,
            })
        })
    }, [modalProps.open, testsets, filteredTestset])

    const selectionWarningMessage = useMemo(() => {
        if (!hasCompatibilityIssue || !selectedTestset) return undefined

        const variantList = normalizedExpectedVariables.length
            ? normalizedExpectedVariables.join(", ")
            : "—"

        return `The testset has no CSV columns matching the expected variables {{${variantList}}}`
    }, [hasCompatibilityIssue, normalizedExpectedVariables, selectedTestset])

    const rowSelection = useMemo(
        () => ({
            selectedRowKeys,
            onChange: (keys: React.Key[]) => {
                setSelectedRowKeys(keys)
            },
            columnTitle: (
                <Tooltip title={selectionWarningMessage}>
                    <span style={{display: "inline-block"}}>
                        <Checkbox
                            indeterminate={
                                selectedRowKeys.length > 0 &&
                                selectedRowKeys.length < testsetCsvData.length
                            }
                            checked={
                                testsetCsvData.length > 0 &&
                                selectedRowKeys.length === testsetCsvData.length
                            }
                            onChange={() => {
                                const allKeys = testsetCsvData.map((_, idx) => idx)
                                if (selectedRowKeys.length === allKeys.length) {
                                    setSelectedRowKeys([])
                                } else if (isChat) {
                                    setSelectedRowKeys(allKeys.slice(0, 1))
                                } else {
                                    setSelectedRowKeys(allKeys)
                                }
                            }}
                        />
                    </span>
                </Tooltip>
            ),
        }),
        [isChat, selectedRowKeys, selectionWarningMessage, setSelectedRowKeys, testsetCsvData],
    )

    const columnDef = useMemo(() => {
        if (!testsetCsvData.length) {
            return [
                {title: "-", width: 300},
                {title: "-", width: 300},
            ]
        }

        const columns: ColumnsType<Testset["csvdata"]> = []

        if (testsetCsvData.length > 0) {
            const keys = Object.keys(testsetCsvData[0]).filter((key) => key !== "testcase_dedup_id")

            columns.push(
                ...keys.map((key, index) => ({
                    title: key,
                    dataIndex: key,
                    key: index,
                    width: 300,
                    onHeaderCell: () => ({
                        style: {minWidth: 160},
                    }),
                    onCell: () => ({
                        title: selectionWarningMessage,
                    }),
                    render: (_: any, record: any) => {
                        const display = getStringOrJson(record[key])
                        const content = (
                            <Expandable
                                expandKey={`${index}-${key}`}
                                className="whitespace-pre-wrap break-words !mb-0"
                            >
                                {display}
                            </Expandable>
                        )
                        return selectionWarningMessage ? (
                            <Tooltip title={selectionWarningMessage}>{content}</Tooltip>
                        ) : (
                            content
                        )
                    },
                })),
            )
        }

        return columns
    }, [selectionWarningMessage, testsetCsvData])

    const dataSource = useMemo(() => {
        if (!testsetCsvData.length) return []
        return testsetCsvData.map((data, index) => ({...data, id: index}))
    }, [testsetCsvData])

    const menuItems = useMemo(() => {
        if (!filteredTestset.length) return []

        const items = filteredTestset.map((ts: testset) => {
            const diagnostics = compatibilityByTestset[ts._id]
            const columnsKnown = diagnostics?.columnsKnown ?? false
            const hasWarning = diagnostics?.hasWarning ?? false

            const tooltip =
                !columnsKnown && normalizedExpectedVariables.length
                    ? "Analyzing columns..."
                    : hasWarning && diagnostics?.missingExpected.length
                      ? `This testset has no CSV columns matching the expected variables`
                      : undefined

            return {
                key: ts._id,
                label: (
                    <Tooltip title={tooltip}>
                        <span
                            className={clsx(
                                "flex items-center gap-2 transition-opacity",
                                hasWarning && "opacity-70 text-gray-600",
                            )}
                        >
                            <span>{ts.name}</span>
                        </span>
                    </Tooltip>
                ),
                __diag: {
                    id: ts._id,
                    name: ts.name,
                    columnsKnown,
                    columns: diagnostics?.columns ?? [],
                    expected: normalizedExpectedVariables,
                    missing: diagnostics?.missingExpected ?? [],
                    hasWarning,
                },
            }
        })

        try {
            console.table(
                items.map((it: any) => ({
                    id: it.__diag.id,
                    name: it.__diag.name,
                    columnsKnown: it.__diag.columnsKnown,
                    columns: it.__diag.columns?.join(", ") || "",
                    expected: it.__diag.expected?.join(", ") || "",
                    missing: it.__diag.missing?.join(", ") || "",
                    hasWarning: it.__diag.hasWarning,
                })),
            )
        } catch {}

        return items
    }, [compatibilityByTestset, filteredTestset, normalizedExpectedVariables])

    const onChangeTestset = useCallback(({key}: any) => {
        setSelectedRowKeys([])
        setSelectedTestset(key)
    }, [])

    const menuSelectedKeys = selectedTestset ? [selectedTestset] : []

    if (!testsets.length && !testsetCsvData.length && !isLoadingTestset && !isLoading)
        return (
            <NoResultsFound
                primaryActionLabel="Create new testset"
                onPrimaryAction={handleCreateTestset}
            />
        )

    return (
        <section className="flex gap-4 flex-1 mt-4">
            <div className="flex flex-col gap-4 w-[200px]">
                <Input.Search
                    placeholder="Search"
                    allowClear
                    onChange={(e) => setSearchTerm(e.target.value)}
                />

                <Divider className="m-0" />

                <Menu
                    items={menuItems}
                    onSelect={onChangeTestset}
                    defaultSelectedKeys={menuSelectedKeys}
                    selectedKeys={menuSelectedKeys}
                    className="h-[500px] overflow-y-auto !border-none"
                />
            </div>

            <Divider orientation="vertical" className="m-0 h-full" />

            <div className="flex flex-col gap-4 flex-1 overflow-x-auto">
                <div className="flex items-start justify-between gap-4">
                    <Typography.Text className="text-lg font-medium -mt-1">
                        Select a testcase
                    </Typography.Text>
                </div>

                <EnhancedTable
                    uniqueKey="load-testset-playground"
                    rowSelection={{
                        type: isChat ? "radio" : "checkbox",
                        ...rowSelection,
                        columnWidth: 46,
                    }}
                    loading={isLoadingTestset || isLoading}
                    dataSource={dataSource}
                    columns={columnDef}
                    className="flex-1"
                    bordered
                    rowKey={"id"}
                    pagination={false}
                    scroll={{y: 520, x: "max-content"}}
                    virtualized
                    onRow={(_, rowIndex) => ({
                        className: "cursor-pointer",
                        title: selectionWarningMessage,
                        onClick: () => {
                            if (rowIndex === undefined) return
                            if (selectedRowKeys.includes(rowIndex)) {
                                setSelectedRowKeys(
                                    selectedRowKeys.filter((row) => row !== rowIndex),
                                )
                            } else if (isChat) {
                                setSelectedRowKeys([rowIndex])
                            } else {
                                setSelectedRowKeys([...selectedRowKeys, rowIndex])
                            }
                        },
                    })}
                />
            </div>
        </section>
    )
}

export default memo(LoadTestsetModalContent)
