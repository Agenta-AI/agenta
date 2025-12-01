import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Input, Tooltip} from "antd"
import Table, {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import dayjs from "dayjs"
import dynamic from "next/dynamic"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {testset} from "@/oss/lib/Types"
import {fetchTestset} from "@/oss/services/testsets/api"
import {useTestsetsData} from "@/oss/state/testset"

import type {SelectTestsetSectionProps} from "../types"

// Regex to extract {{variable}} patterns from prompt text
const VARIABLE_REGEX = /\{\{([^{}]+)\}\}/g

/**
 * Extract variables from a prompt message content string
 */
const extractVariables = (content: string): string[] => {
    const vars: string[] = []
    let match
    while ((match = VARIABLE_REGEX.exec(content)) !== null) {
        vars.push(match[1].trim())
    }
    return vars
}

/**
 * Extract input_keys from variant's parameters (ag_config)
 * This is used for completion/custom apps where inputs are defined in the config
 */
const extractInputKeysFromParameters = (variant: EnhancedVariant): string[] => {
    try {
        const params = (variant as any)?.parameters
        const agConfig = params?.ag_config ?? params ?? {}
        const keys = new Set<string>()

        Object.values(agConfig || {}).forEach((cfg: any) => {
            const arr = cfg?.input_keys
            if (Array.isArray(arr)) {
                arr.forEach((k) => {
                    if (typeof k === "string" && k) keys.add(k)
                })
            }
        })

        return Array.from(keys)
    } catch {
        return []
    }
}

/**
 * Extract input variables from an EnhancedVariant's prompts ({{variable}} patterns)
 * This is used for chat apps where variables are embedded in message templates
 */
const extractVariablesFromPrompts = (variant: EnhancedVariant): string[] => {
    const vars = new Set<string>()

    ;(variant.prompts || []).forEach((prompt: any) => {
        const messages = prompt?.messages?.value || []
        messages.forEach((message: any) => {
            const content = message?.content?.value
            if (typeof content === "string") {
                extractVariables(content).forEach((v) => vars.add(v))
            } else if (Array.isArray(content)) {
                content.forEach((part: any) => {
                    const text = part?.text?.value ?? part?.text ?? ""
                    if (typeof text === "string") {
                        extractVariables(text).forEach((v) => vars.add(v))
                    }
                })
            }
        })
    })

    return Array.from(vars)
}

/**
 * Extract input variables from an EnhancedVariant
 * Combines both input_keys from parameters and {{variables}} from prompts
 */
const extractVariablesFromVariant = (variant: EnhancedVariant): string[] => {
    const vars = new Set<string>()

    // First, try to get input_keys from parameters (for completion/custom apps)
    extractInputKeysFromParameters(variant).forEach((v) => vars.add(v))

    // Then, extract {{variables}} from prompts (for chat apps)
    extractVariablesFromPrompts(variant).forEach((v) => vars.add(v))

    return Array.from(vars)
}

const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
    ssr: false,
})

const SelectTestsetSection = ({
    testsets: propsTestsets,
    selectedTestsetId,
    setSelectedTestsetId,
    handlePanelChange,
    selectedVariantRevisionIds,
    selectedVariants,
    className,
    ...props
}: SelectTestsetSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const {testsets: fetchedTestsets, columnsByTestsetId} = useTestsetsData()
    const testsets = useMemo(() => {
        return propsTestsets && propsTestsets.length > 0 ? propsTestsets : fetchedTestsets || []
    }, [propsTestsets, fetchedTestsets])

    // Stable flag for whether any revision is selected
    const hasSelectedRevision = useMemo(
        () => (selectedVariantRevisionIds?.length ?? 0) > 0,
        [selectedVariantRevisionIds],
    )

    // Extract expected input variables directly from the selected variant's prompts
    // This ensures we check against the variant selected in the modal, not the global app context
    const expectedVariables = useMemo(() => {
        if (!hasSelectedRevision || !selectedVariants?.length) return []

        // Get the first selected variant (for single selection) or combine all variables
        const allVariables = new Set<string>()
        selectedVariants.forEach((variant) => {
            extractVariablesFromVariant(variant).forEach((v) => allVariables.add(v))
        })

        return Array.from(allVariables)
            .map((variable) => variable.trim())
            .filter(Boolean)
    }, [hasSelectedRevision, selectedVariants])

    const hasExpectedVariables = expectedVariables.length > 0

    const queryClient = useQueryClient()

    useEffect(() => {
        if (!hasSelectedRevision || !hasExpectedVariables) return
        if (!Array.isArray(testsets) || testsets.length === 0) return

        const pending = testsets.filter((ts) => {
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
    }, [columnsByTestsetId, hasExpectedVariables, hasSelectedRevision, queryClient, testsets])

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

        ;(testsets || []).forEach((ts) => {
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
    }, [columnsByTestsetId, hasExpectedVariables, hasSelectedRevision, expectedVariables, testsets])

    const getTestsetMessage = useCallback(
        (testsetId: string) => compatibilityByTestset[testsetId]?.message,
        [compatibilityByTestset],
    )

    const _selectedTestsetMessage = useMemo(() => {
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
        let allTestsets = testsets.sort(
            (a: testset, b: testset) =>
                dayjs(b.updated_at).valueOf() - dayjs(a.updated_at).valueOf(),
        )
        if (searchTerm) {
            allTestsets = testsets.filter((item: testset) =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }
        return allTestsets
    }, [searchTerm, testsets])

    const selectedTestset = useMemo(
        () => testsets.find((testset) => testset._id === selectedTestsetId) || null,
        [selectedTestsetId, testsets],
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
