import React, {memo, useCallback, useMemo, useState} from "react"

import {Tabs, TabsProps, Typography} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"
import dynamic from "next/dynamic"

import {KeyValuePair} from "@/oss/lib/Types"

import {updateTestsetRowDataAtom, testsetRowDrawerAtom} from "../store/testsetRowDrawerStore"

import {isMessageFormat, messageFormatToString} from "./utils/isMessageFormat"

const SharedEditor = dynamic(() => import("@/oss/components/Playground/Components/SharedEditor"), {
    ssr: false,
})

interface TestsetRowDrawerContentProps {
    rowData: KeyValuePair
}

const TestsetRowDrawerContent: React.FC<TestsetRowDrawerContentProps> = ({rowData}) => {
    const [, updateRowData] = useAtom(updateTestsetRowDataAtom)
    const [drawerState] = useAtom(testsetRowDrawerAtom)
    const [activeTab, setActiveTab] = useState<"overview" | "json">("overview")

    const handleFieldChange = (field: string, value: string) => {
        updateRowData({[field]: value})
    }

    const jsonString = useMemo(() => {
        return JSON.stringify(rowData, null, 2)
    }, [rowData])

    const handleJsonChange = useCallback(
        (value: string) => {
            try {
                const parsed = JSON.parse(value)
                // Replace the entire row data with parsed JSON
                // Use rowData prop for comparison to ensure we're comparing against the current displayed data
                const updates: KeyValuePair = {}
                for (const key in parsed) {
                    updates[key] = parsed[key]
                }
                // Clear old keys that aren't in the new JSON
                for (const key in rowData) {
                    if (!(key in parsed)) {
                        updates[key] = ""
                    }
                }
                updateRowData(updates)
            } catch (error) {
                // Ignore parse errors - SharedEditor will handle validation
            }
        },
        [rowData, updateRowData],
    )

    const tabItems = useMemo(() => {
        return [
            {
                key: "overview",
                label: "Overview",
                className: "w-full h-full flex flex-col px-4",
                children: (
                    <div className="py-4 flex flex-col gap-2">
                        {Object.entries(rowData).map(([key, value]) => {
                            const isMessages = isMessageFormat(value)

                            if (isMessages) {
                                // Render as formatted JSON with syntax highlighting
                                const messageString = messageFormatToString(value)
                                return (
                                    <SharedEditor
                                        key={`${drawerState.selectedRowIndex}-${key}`}
                                        header={
                                            <Typography className="font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
                                                {key}
                                            </Typography>
                                        }
                                        editorType="border"
                                        handleChange={(newValue) =>
                                            handleFieldChange(key, newValue)
                                        }
                                        initialValue={messageString}
                                        placeholder={`Enter ${key}...`}
                                        className="relative flex flex-col gap-1 rounded-[8px]"
                                        editorProps={{
                                            codeOnly: true,
                                            enableResize: true,
                                            boundWidth: true,
                                        }}
                                    />
                                )
                            }

                            // Render as regular text editor
                            return (
                                <SharedEditor
                                    key={`${drawerState.selectedRowIndex}-${key}`}
                                    header={
                                        <Typography className="font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
                                            {key}
                                        </Typography>
                                    }
                                    editorType="border"
                                    handleChange={(newValue) => handleFieldChange(key, newValue)}
                                    initialValue={value as string}
                                    placeholder={`Enter ${key}...`}
                                    className="relative flex flex-col gap-1 rounded-[8px]"
                                    editorProps={{enableResize: true, boundWidth: true}}
                                />
                            )
                        })}
                    </div>
                ),
            },
            {
                key: "json",
                label: "JSON",
                className: "h-full flex flex-col px-4",
                children: (
                    <div className="py-4 w-full h-full">
                        <SharedEditor
                            key={`${drawerState.selectedRowIndex}-json`}
                            editorProps={{
                                codeOnly: true,
                                validationSchema: {
                                    type: "object",
                                    properties: {},
                                },
                            }}
                            editorType="border"
                            initialValue={jsonString}
                            value={jsonString}
                            handleChange={handleJsonChange}
                            state="filled"
                            className="!w-full *:font-mono"
                        />
                    </div>
                ),
            },
        ] as TabsProps["items"]
    }, [rowData, jsonString, handleJsonChange, drawerState.selectedRowIndex])

    return (
        <div
            className={clsx([
                "flex items-center justify-center flex-col",
                "w-full h-full",
                "[&_.ant-tabs]:w-full [&_.ant-tabs]:h-full",
                "[&_.ant-tabs]:grow [&_.ant-tabs]:flex [&_.ant-tabs]:flex-col",
                "[&_.ant-tabs-content]:grow [&_.ant-tabs-content]:w-full [&_.ant-tabs-content]:h-full",
                "[&_.ant-tabs-nav-wrap]:!px-4 [&_.ant-tabs-nav]:sticky [&_.ant-tabs-nav]:top-[0px] [&_.ant-tabs-nav]:z-40 [&_.ant-tabs-nav]:bg-white",
            ])}
        >
            <Tabs
                destroyOnHidden
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as "overview" | "json")}
                className="overflow-auto"
                items={tabItems}
            />
        </div>
    )
}

export default memo(TestsetRowDrawerContent)
