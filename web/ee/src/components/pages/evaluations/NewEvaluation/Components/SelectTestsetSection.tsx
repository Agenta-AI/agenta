import {memo, useMemo, useState} from "react"
import dynamic from "next/dynamic"

import {Input} from "antd"
import Table, {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import dayjs from "dayjs"

import {formatDate, formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {testset} from "@/oss/lib/Types"
import {useTestsets} from "@/oss/services/testsets/api"

import type {SelectTestsetSectionProps} from "../types"

const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
    ssr: false,
})

const SelectTestsetSection = ({
    testSets: propsTestsets,
    selectedTestsetId,
    setSelectedTestsetId,
    handlePanelChange,
    className,
    ...props
}: SelectTestsetSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const {data: fetchedTestSets} = useTestsets()
    const testSets = useMemo(() => {
        return propsTestsets && propsTestsets.length > 0 ? propsTestsets : fetchedTestSets || []
    }, [propsTestsets, fetchedTestSets])

    const columns: ColumnsType<testset> = useMemo(() => {
        return [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                onHeaderCell: () => ({
                    style: {minWidth: 220},
                }),
            },
            {
                title: "Date Modified",
                dataIndex: "updated_at",
                key: "updated_at",
                onHeaderCell: () => ({
                    style: {minWidth: 220},
                }),
                render: (date: string) => {
                    return formatDay({date, outputFormat: "DD MMM YYYY | h:mm a"})
                },
            },
            {
                title: "Date created",
                dataIndex: "created_at",
                key: "created_at",
                render: (date: string) => {
                    return formatDay({date, outputFormat: "DD MMM YYYY | h:mm a"})
                },
                onHeaderCell: () => ({
                    style: {minWidth: 220},
                }),
            },
        ]
    }, [])

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
            <div className="flex items-center justify-between mb-2">
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
                    selectedRowKeys: [selectedTestset?._id as React.Key],
                    onChange: (selectedRowKeys) => {
                        setSelectedTestsetId(selectedRowKeys[0] as string)
                        handlePanelChange("variantPanel")
                    },
                }}
                className={`ph-no-capture`}
                columns={columns}
                dataSource={filteredTestset}
                rowKey="_id"
                scroll={{x: true, y: 455}}
                bordered
                pagination={false}
                locale={{
                    emptyText: (
                        <NoResultsFound
                            className="!py-10"
                            description="No available testsets found to display"
                        />
                    ),
                }}
                onRow={(record) => ({
                    style: {cursor: "pointer"},
                    onClick: () => {
                        if (selectedTestset?._id === record._id) {
                            setSelectedTestsetId("")
                        } else {
                            setSelectedTestsetId(record._id)
                            handlePanelChange("variantPanel")
                        }
                    },
                })}
            />
        </div>
    )
}

export default memo(SelectTestsetSection)
