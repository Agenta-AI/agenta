import {useCallback, useEffect, useMemo, useState} from "react"

import {Button, Modal, Select, Space, Table, Typography} from "antd"
import {useAtomValue} from "jotai"

import type {testset} from "@/oss/lib/Types"
import {fetchTestcasesPage} from "@/oss/state/entities/testcase/queries"
import {projectIdAtom} from "@/oss/state/project"

interface EvaluatorTestcaseModalProps {
    open: boolean
    onCancel: () => void
    testsets: testset[]
    setSelectedTestcase: (data: {testcase: Record<string, any> | null}) => void
    selectedTestset: string
    setSelectedTestset: (id: string) => void
}

/**
 * Modal for selecting a testcase from a testset for evaluator testing
 * Uses fetchTestcasesPage for data fetching
 */
const EvaluatorTestcaseModal = ({
    open,
    onCancel,
    testsets,
    setSelectedTestcase,
    selectedTestset,
    setSelectedTestset,
}: EvaluatorTestcaseModalProps) => {
    const projectId = useAtomValue(projectIdAtom)
    const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null)
    const [testcases, setTestcases] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(false)

    // Get the selected testset's latest revision ID
    const activeTestset = useMemo(
        () => testsets.find((ts) => ts._id === selectedTestset),
        [testsets, selectedTestset],
    )

    // Fetch testcases when testset changes
    useEffect(() => {
        if (!projectId || !activeTestset?._id || !open) {
            setTestcases([])
            return
        }

        const fetchData = async () => {
            setIsLoading(true)
            try {
                const result = await fetchTestcasesPage(projectId, activeTestset._id, null)
                setTestcases(result.testcases)
            } catch (error) {
                console.error("Failed to fetch testcases:", error)
                setTestcases([])
            } finally {
                setIsLoading(false)
            }
        }

        fetchData()
    }, [projectId, activeTestset?._id, open])

    // Build table columns from testcase data
    const columns = useMemo(() => {
        if (!testcases.length) return []

        // Get all unique keys from testcases (excluding metadata)
        const allKeys = new Set<string>()
        testcases.forEach((tc: any) => {
            const data = tc.testcase || tc.data || tc
            if (data && typeof data === "object") {
                Object.keys(data).forEach((key) => {
                    // Skip metadata fields
                    if (
                        ![
                            "id",
                            "testset_id",
                            "set_id",
                            "created_at",
                            "updated_at",
                            "deleted_at",
                            "created_by_id",
                            "updated_by_id",
                            "deleted_by_id",
                        ].includes(key)
                    ) {
                        allKeys.add(key)
                    }
                })
            }
        })

        return Array.from(allKeys).map((key) => ({
            title: key,
            dataIndex: key,
            key,
            ellipsis: true,
            width: 150,
            render: (value: any) => {
                if (value === null || value === undefined) return "-"
                if (typeof value === "object") return JSON.stringify(value)
                return String(value)
            },
        }))
    }, [testcases])

    // Transform testcases to table data
    const tableData = useMemo(() => {
        return testcases.map((tc: any, index: number) => {
            const data = tc.testcase || tc.data || tc
            return {
                key: tc.id || `row-${index}`,
                ...data,
                __original: tc,
            }
        })
    }, [testcases])

    const handleSelect = useCallback(() => {
        if (!selectedRowKey) return

        const selected = tableData.find((row) => row.key === selectedRowKey)
        if (selected) {
            // Extract just the testcase data (without metadata)
            const {key, __original, ...testcaseData} = selected
            setSelectedTestcase({testcase: testcaseData})
        }
        onCancel()
    }, [selectedRowKey, tableData, setSelectedTestcase, onCancel])

    const testsetOptions = useMemo(
        () =>
            testsets.map((ts) => ({
                label: ts.name,
                value: ts._id,
            })),
        [testsets],
    )

    return (
        <Modal
            title="Select Testcase"
            open={open}
            onCancel={onCancel}
            width={800}
            footer={
                <Space>
                    <Button onClick={onCancel}>Cancel</Button>
                    <Button type="primary" disabled={!selectedRowKey} onClick={handleSelect}>
                        Select
                    </Button>
                </Space>
            }
        >
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <Typography.Text>Testset:</Typography.Text>
                    <Select
                        style={{width: 300}}
                        placeholder="Select a testset"
                        value={selectedTestset || undefined}
                        onChange={(value) => {
                            setSelectedTestset(value)
                            setSelectedRowKey(null)
                        }}
                        options={testsetOptions}
                    />
                </div>

                <Table
                    size="small"
                    loading={isLoading}
                    columns={columns}
                    dataSource={tableData}
                    scroll={{x: "max-content", y: 400}}
                    pagination={{pageSize: 10, showSizeChanger: false}}
                    rowSelection={{
                        type: "radio",
                        selectedRowKeys: selectedRowKey ? [selectedRowKey] : [],
                        onChange: (keys) => setSelectedRowKey(keys[0] as string),
                    }}
                    onRow={(record) => ({
                        onClick: () => setSelectedRowKey(record.key as string),
                        style: {cursor: "pointer"},
                    })}
                    locale={{
                        emptyText: selectedTestset
                            ? "No testcases found"
                            : "Select a testset to view testcases",
                    }}
                />
            </div>
        </Modal>
    )
}

export default EvaluatorTestcaseModal
