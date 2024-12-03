import React, {useEffect, useMemo, useState} from "react"
import GenericDrawer from "@/components/GenericDrawer"
import {ArrowRight, PencilSimple, Plus, Trash} from "@phosphor-icons/react"
import {
    Button,
    Checkbox,
    Divider,
    Drawer,
    Input,
    message,
    Radio,
    Select,
    Table,
    Typography,
} from "antd"
import CopyButton from "@/components/CopyButton/CopyButton"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {Editor} from "@monaco-editor/react"
import {createUseStyles} from "react-jss"
import {JSSTheme, KeyValuePair, testset} from "@/lib/Types"
import {
    createNewTestset,
    fetchTestset,
    updateTestset,
    useLoadTestsetsList,
} from "@/services/testsets/api"
import {collectKeyPathsFromObject, getStringOrJson} from "@/lib/helpers/utils"
import yaml from "js-yaml"
import {useUpdateEffect} from "usehooks-ts"
import {ResizableTitle} from "@/components/ServerTable/components"
import useResizeObserver from "@/hooks/useResizeObserver"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    editor: {
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
        "& .monaco-editor": {
            width: "0 !important",
        },
    },
    drawerHeading: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    container: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },
    label: {
        fontWeight: theme.fontWeightMedium,
    },
}))

type Mapping = {data: string; column: string; newColumn?: string}
type TraceData = {key: string; data: KeyValuePair; id: number}
type Preview = {key: string; data: KeyValuePair[]}
type Props = {
    onClose: () => void
    data: TraceData[]
} & React.ComponentProps<typeof Drawer>

const TestsetDrawer = ({onClose, data, ...props}: Props) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const {testsets: listOfTestsets, isTestsetsLoading} = useLoadTestsetsList()
    const elemRef = useResizeObserver<HTMLDivElement>((rect) => {
        setIsDrawerExtended(rect.width > 640)
    })

    const [isDrawerExtended, setIsDrawerExtended] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [traceData, setTraceData] = useState(data.length > 0 ? data : [])
    const [testset, setTestset] = useState({name: "", id: ""})
    const [testsetName, setTestsetName] = useState("")
    const [editorFormat, setEditorFormat] = useState("JSON")
    const [tableColumns, setTableColumns] = useState<string[]>([])
    const [tableRows, setTableRows] = useState<KeyValuePair[]>([])
    const [showLastFiveRows, setShowLastFiveRows] = useState(false)
    const [dataPreview, setDataPreview] = useState(traceData[0]?.key || "")
    const [mappingData, setMappingData] = useState<Mapping[]>([])
    const [preview, setPreview] = useState<Preview>({key: traceData[0]?.key || "", data: []})

    const isNewTestset = testset.id === "create"
    const elementWidth = isDrawerExtended ? 200 * 2 : 200
    const isMapColumnExist = mappingData.some((mapping) =>
        mapping.column === "create" || !mapping.column ? !!mapping?.newColumn : !!mapping.column,
    )

    // predefind options
    const customSelectOptions = useMemo(
        () => [
            {value: "create", label: "Create New"},
            {
                value: "divider",
                label: <Divider className="!my-1" />,
                className: "!p-0 !m-0 !min-h-0.5 !cursor-default",
                disabled: true,
            },
        ],
        [],
    )

    const onTestsetOptionChange = async (option: {label: string; value: string}) => {
        const {value, label} = option

        try {
            resetStates()
            setTestset({name: label, id: value})

            if (value && value !== "create") {
                const data = await fetchTestset(value)
                if (data?.csvdata?.length) {
                    setTableColumns(Object.keys(data.csvdata[0]))
                    setTableRows(data.csvdata)
                }
            }

            if (mappingOptions.length > 0 && value) {
                setMappingData((prevMappingData) =>
                    mappingOptions.map((item, index) => ({
                        ...prevMappingData[index],
                        data: item.value,
                    })),
                )
            }
        } catch (error) {
            message.error("Failed to laod Test sets!")
        }
    }

    const onRemoveTraceData = () => {
        const removeTrace = traceData.filter((trace) => trace.key !== dataPreview)
        setTraceData(removeTrace)

        if (removeTrace.length > 0) {
            const currentIndex = traceData.findIndex((trace) => trace.key === dataPreview)
            // [currentIndex]: Next option in list | [currentIndex - 1]: Previous option if next doesn't exist | [0]: Default to first option
            const nextPreview =
                removeTrace[currentIndex] || removeTrace[currentIndex - 1] || removeTrace[0]

            setDataPreview(nextPreview.key)

            if (dataPreview === preview.key) {
                onPreviewOptionChange(nextPreview.key)
            }
        } else {
            setDataPreview("")
        }
    }

    const formatDataPreview = useMemo(() => {
        if (!traceData?.length) return ""

        const jsonObject = {
            data: traceData.find((trace) => trace?.key === dataPreview)?.data || traceData[0]?.data,
        }
        if (!jsonObject) return ""

        try {
            return editorFormat === "YAML" ? yaml.dump(jsonObject) : getStringOrJson(jsonObject)
        } catch (error) {
            message.error("Failed to convert JSON to YAML. Please ensure the data is valid.")
            return getStringOrJson(jsonObject)
        }
    }, [editorFormat, traceData, dataPreview])

    const mappingOptions = useMemo(() => {
        const uniquePaths = new Set<string>()

        traceData.forEach((traceItem) => {
            const traceKeys = collectKeyPathsFromObject(traceItem?.data, "data")
            traceKeys.forEach((key) => uniquePaths.add(key))
        })

        return Array.from(uniquePaths).map((item) => ({value: item}))
    }, [data])

    const columnOptions = useMemo(() => {
        const selectedColumns = mappingData
            .map((item) => item.column)
            .filter((col) => col !== "create")
        return tableColumns.filter((column) => !selectedColumns.includes(column))
    }, [mappingData, tableColumns])

    const onMappingOptionChange = ({
        pathName,
        value,
        idx,
    }: {
        pathName: keyof Mapping
        value: string
        idx: number
    }) => {
        setMappingData((prev) => {
            const newData = [...prev]
            newData[idx] = {...newData[idx], [pathName]: value}
            return newData
        })
    }

    const onPreviewOptionChange = (value: string) => {
        let newTestsetData
        if (value === "all") {
            newTestsetData = mapAndConvertDataInCsvFormat(traceData)
        } else {
            const selectedTraceData = traceData.filter((trace) => trace.key === value)
            newTestsetData = mapAndConvertDataInCsvFormat(selectedTraceData)
        }

        setPreview({key: value, data: newTestsetData})
    }

    useUpdateEffect(() => {
        if (isMapColumnExist) {
            onPreviewOptionChange(preview.key)
        }
    }, [mappingData])

    const resetStates = () => {
        setTableColumns([])
        setTableRows([])
        setShowLastFiveRows(false)
        setMappingData((prev) => prev.map((item) => ({...item, column: "", newColumn: ""})))
        setPreview({key: traceData[0]?.key || "", data: []})
        setTestsetName("")
    }

    const mapAndConvertDataInCsvFormat = (traceData: TraceData[]) => {
        return traceData.map((item) => {
            const formattedItem: Record<string, any> = {}

            for (const mapping of mappingData) {
                const keys = mapping.data.split(".")
                let value = keys.reduce((acc: any, key) => acc?.[key], item)

                const targetKey =
                    mapping.column === "create" || !mapping.column
                        ? mapping.newColumn
                        : mapping.column

                if (targetKey) {
                    formattedItem[targetKey] =
                        value === undefined || value === null
                            ? ""
                            : typeof value === "string"
                              ? value
                              : JSON.stringify(value)
                }
            }

            return formattedItem
        })
    }

    const onSaveTestset = async () => {
        try {
            setIsLoading(true)

            const newTestsetData = mapAndConvertDataInCsvFormat(traceData)

            if (isNewTestset) {
                if (!testsetName) {
                    message.error("Please add a Test set name before saving it")
                    return
                }

                await createNewTestset(testsetName, newTestsetData)
                message.success("Test set created successfully")
            } else {
                await updateTestset(testset.id as string, testset.name, [
                    ...newTestsetData,
                    ...tableRows,
                ])
                message.success("Test set updated successfully")
            }

            onClose()
        } catch (error) {
            console.log(error)
            message.error("Something went wrong. Please try again later")
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <>
            <GenericDrawer
                {...props}
                destroyOnClose
                onClose={onClose}
                expandable
                initialWidth={640}
                headerExtra="Add to test set"
                footer={
                    <div className="flex justify-end items-center gap-2 py-2 px-3">
                        <Button onClick={onClose}>Cancel</Button>
                        <Button
                            type="primary"
                            loading={isLoading || isTestsetsLoading}
                            onClick={onSaveTestset}
                            disabled={!testset.name || !isMapColumnExist}
                        >
                            Save
                        </Button>
                    </div>
                }
                mainContent={
                    <section ref={elemRef} className="w-full flex flex-col gap-6">
                        <Typography.Text className={classes.drawerHeading}>
                            Spans selected {traceData.length}
                        </Typography.Text>

                        <div className={classes.container}>
                            <Typography.Text className={classes.label}>Test set</Typography.Text>
                            <div className="flex gap-2">
                                <Select
                                    showSearch
                                    labelInValue
                                    style={{width: elementWidth}}
                                    placeholder="Select Test set"
                                    value={
                                        testset.id
                                            ? {label: testset.name, value: testset.id}
                                            : undefined
                                    }
                                    onChange={onTestsetOptionChange}
                                    options={[
                                        ...customSelectOptions,
                                        ...listOfTestsets.map((item: testset) => ({
                                            value: item._id,
                                            label: item.name,
                                        })),
                                    ]}
                                    filterOption={(input, option) =>
                                        (option?.label ?? "")
                                            .toString()
                                            .toLowerCase()
                                            .includes(input.toLowerCase())
                                    }
                                    loading={isTestsetsLoading}
                                />

                                {isNewTestset && (
                                    <div className="relative">
                                        <Input
                                            style={{width: elementWidth}}
                                            value={testsetName}
                                            onChange={(e) => setTestsetName(e.target.value)}
                                            placeholder="Test set name"
                                        />
                                        <PencilSimple
                                            size={14}
                                            className="absolute top-[8px] right-2"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={classes.container}>
                            <Typography.Text className={classes.label}>
                                Data preview
                            </Typography.Text>

                            <div className="flex justify-between items-center mb-2">
                                <Select
                                    style={{width: elementWidth}}
                                    value={dataPreview}
                                    onChange={(value) => setDataPreview(value)}
                                    options={traceData.map((trace) => ({
                                        value: trace?.key,
                                        label: `Span ${trace.id}`,
                                    }))}
                                />
                                <div className="flex justify-between items-center gap-2">
                                    {traceData.length > 1 && (
                                        <Button
                                            variant="text"
                                            color="danger"
                                            icon={<Trash size={14} />}
                                            onClick={onRemoveTraceData}
                                        >
                                            Remove span{" "}
                                            {
                                                traceData.find((trace) => trace.key === dataPreview)
                                                    ?.id
                                            }
                                        </Button>
                                    )}

                                    <Radio.Group
                                        options={[
                                            {label: "JSON", value: "JSON"},
                                            {label: "YAML", value: "YAML"},
                                        ]}
                                        onChange={(e) => setEditorFormat(e.target.value)}
                                        value={editorFormat}
                                        optionType="button"
                                    />
                                    <CopyButton
                                        buttonText=""
                                        icon={true}
                                        text={formatDataPreview}
                                    />
                                </div>
                            </div>

                            <Editor
                                className={classes.editor}
                                height={210}
                                language={editorFormat.toLowerCase()}
                                theme={`vs-${appTheme}`}
                                value={formatDataPreview}
                                options={{
                                    wordWrap: "on",
                                    minimap: {enabled: false},
                                    scrollBeyondLastLine: false,
                                    readOnly: true,
                                    lineNumbers: "off",
                                    lineDecorationsWidth: 0,
                                    scrollbar: {
                                        verticalScrollbarSize: 8,
                                        horizontalScrollbarSize: 8,
                                    },
                                }}
                            />
                        </div>

                        <div className={classes.container}>
                            <Typography.Text className={classes.label}>Mapping</Typography.Text>
                            {testset.id ? (
                                <>
                                    <div className="flex flex-col gap-2">
                                        {mappingData.map((data, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-center justify-between gap-2"
                                            >
                                                <Select
                                                    style={{width: elementWidth}}
                                                    value={data.data}
                                                    onChange={(value) =>
                                                        onMappingOptionChange({
                                                            pathName: "data",
                                                            value,
                                                            idx,
                                                        })
                                                    }
                                                    options={mappingOptions}
                                                />
                                                <ArrowRight size={16} />
                                                <div className="flex-1 flex gap-2 items-center">
                                                    {!isNewTestset && (
                                                        <Select
                                                            style={{width: "100%"}}
                                                            value={data.column}
                                                            onChange={(value) =>
                                                                onMappingOptionChange({
                                                                    pathName: "column",
                                                                    value,
                                                                    idx,
                                                                })
                                                            }
                                                            options={[
                                                                ...(testset.id
                                                                    ? customSelectOptions
                                                                    : []),
                                                                ...columnOptions?.map((column) => ({
                                                                    value: column,
                                                                    lable: column,
                                                                })),
                                                            ]}
                                                        />
                                                    )}

                                                    {data.column === "create" || isNewTestset ? (
                                                        <div className="w-full relative">
                                                            <Input
                                                                style={{width: "100%"}}
                                                                value={data.newColumn || ""}
                                                                onChange={(e) =>
                                                                    onMappingOptionChange({
                                                                        pathName: "newColumn",
                                                                        value: e.target.value,
                                                                        idx,
                                                                    })
                                                                }
                                                                placeholder="Column name"
                                                            />
                                                            <PencilSimple
                                                                size={14}
                                                                className="absolute top-[8px] right-2"
                                                            />
                                                        </div>
                                                    ) : null}
                                                </div>

                                                <Button
                                                    icon={<Trash />}
                                                    onClick={() =>
                                                        setMappingData(
                                                            mappingData.filter(
                                                                (_, index) => index !== idx,
                                                            ),
                                                        )
                                                    }
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    <Button
                                        type="dashed"
                                        className="mt-1"
                                        style={{width: elementWidth}}
                                        icon={<Plus />}
                                        onClick={() =>
                                            setMappingData([
                                                ...mappingData,
                                                {
                                                    data: "",
                                                    column: isNewTestset ? "create" : "",
                                                    newColumn: "",
                                                },
                                            ])
                                        }
                                    >
                                        Add field
                                    </Button>
                                </>
                            ) : (
                                <Typography.Text>
                                    Please select a test set to create mappings
                                </Typography.Text>
                            )}
                        </div>

                        <div className={classes.container}>
                            <Typography.Text className={classes.label}>Preview</Typography.Text>
                            {isMapColumnExist ? (
                                <>
                                    <div className="flex items-center gap-4 mb-2">
                                        <Select
                                            style={{width: elementWidth}}
                                            value={preview.key}
                                            onChange={onPreviewOptionChange}
                                            options={[
                                                {value: "all", label: "Show All Spans"},
                                                ...traceData.map((trace, idx) => ({
                                                    value: trace?.key,
                                                    label: `Span ${trace.id}`,
                                                })),
                                            ]}
                                        />

                                        {!isNewTestset && (
                                            <Checkbox
                                                checked={showLastFiveRows}
                                                onChange={() =>
                                                    setShowLastFiveRows(!showLastFiveRows)
                                                }
                                            >
                                                Show last {tableRows.slice(-5).length} test cases in
                                                test set
                                            </Checkbox>
                                        )}
                                    </div>

                                    <div>
                                        <Table
                                            className="ph-no-capture"
                                            columns={mappingData.map((data, idx) => {
                                                const columnData =
                                                    data.column === "create" || !data.column
                                                        ? data.newColumn
                                                        : data.column
                                                return {
                                                    title: columnData,
                                                    dataIndex: columnData,
                                                    key: idx,
                                                    width: 250,
                                                    onHeaderCell: () => ({
                                                        style: {minWidth: 200},
                                                    }),
                                                }
                                            })}
                                            dataSource={[
                                                ...preview.data,
                                                ...(showLastFiveRows ? tableRows.slice(-5) : []),
                                            ]}
                                            rowClassName={(_, index) => {
                                                if (showLastFiveRows) {
                                                    const totalRows =
                                                        preview.data.length +
                                                        tableRows.slice(-5).length

                                                    if (
                                                        index >=
                                                        totalRows - tableRows.slice(-5).length
                                                    ) {
                                                        return "!bg-[#fafafa]"
                                                    }
                                                }
                                                return ""
                                            }}
                                            components={{
                                                header: {
                                                    cell: ResizableTitle,
                                                },
                                            }}
                                            scroll={{x: "max-content"}}
                                            bordered
                                            pagination={false}
                                        />
                                    </div>
                                </>
                            ) : (
                                <Typography.Text>
                                    Please select test set to view test set preview.
                                </Typography.Text>
                            )}
                        </div>
                    </section>
                }
            />
        </>
    )
}

export default TestsetDrawer
