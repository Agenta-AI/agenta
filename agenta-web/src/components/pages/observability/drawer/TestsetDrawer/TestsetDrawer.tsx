import {useCallback, useMemo, useState} from "react"
import GenericDrawer from "@/components/GenericDrawer"
import {ArrowRight, FloppyDiskBack, PencilSimple, Plus, Trash} from "@phosphor-icons/react"
import {
    Button,
    Checkbox,
    Divider,
    Input,
    message,
    Modal,
    Radio,
    Select,
    Table,
    Typography,
    AutoComplete,
} from "antd"
import CopyButton from "@/components/CopyButton/CopyButton"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {Editor} from "@monaco-editor/react"
import {KeyValuePair, testset} from "@/lib/Types"
import {
    createNewTestset,
    fetchTestset,
    updateTestset,
    useLoadTestsetsList,
} from "@/services/testsets/api"
import {collectKeyPathsFromObject, getYamlOrJson} from "@/lib/helpers/utils"
import yaml from "js-yaml"
import {useUpdateEffect} from "usehooks-ts"
import useResizeObserver from "@/hooks/useResizeObserver"
import {Mapping, Preview, TestsetTraceData, TestsetDrawerProps, TestsetColumn} from "./assets/types"
import {useStyles} from "./assets/styles"
import clsx from "clsx"

const TestsetDrawer = ({onClose, data, ...props}: TestsetDrawerProps) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const {testsets: listOfTestsets, isTestsetsLoading, mutate} = useLoadTestsetsList()
    const elemRef = useResizeObserver<HTMLDivElement>((rect) => {
        setIsDrawerExtended(rect.width > 640)
    })

    const [isDrawerExtended, setIsDrawerExtended] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [traceData, setTraceData] = useState<TestsetTraceData[]>([])
    const [updatedTraceData, setUpdatedTraceData] = useState("")
    const [testset, setTestset] = useState({name: "", id: ""})
    const [newTestsetName, setNewTestsetName] = useState("")
    const [editorFormat, setEditorFormat] = useState<"JSON" | "YAML">("JSON")
    const [selectedTestsetColumns, setSelectedTestsetColumns] = useState<TestsetColumn[]>([])
    const [selectedTestsetRows, setSelectedTestsetRows] = useState<KeyValuePair[]>([])
    const [showLastFiveRows, setShowLastFiveRows] = useState(false)
    const [rowDataPreview, setRowDataPreview] = useState("")
    const [mappingData, setMappingData] = useState<Mapping[]>([])
    const [preview, setPreview] = useState<Preview>({key: traceData[0]?.key || "", data: []})
    const [hasDuplicateColumns, setHasDuplicateColumns] = useState(false)
    const [isConfirmSave, setIsConfirmSave] = useState(false)

    const isNewTestset = testset.id === "create"
    const elementWidth = isDrawerExtended ? 200 * 2 : 200
    const selectedTestsetTestCases = selectedTestsetRows.slice(-5)
    const isNewColumnCreated = useMemo(
        () => selectedTestsetColumns.find(({isNew}) => isNew),
        [selectedTestsetColumns],
    )
    const isMapColumnExist = useMemo(
        () =>
            mappingData.some((mapping) =>
                mapping.column === "create" || !mapping.column
                    ? !!mapping?.newColumn
                    : !!mapping.column,
            ),
        [mappingData],
    )
    const selectedTraceData = useMemo(
        () => traceData.find((trace) => trace.key === rowDataPreview),
        [rowDataPreview, traceData],
    )
    const formatDataPreview = useMemo(() => {
        if (!traceData?.length) return ""

        const jsonObject = {data: selectedTraceData?.data || traceData[0]?.data}
        if (!jsonObject) return ""

        return getYamlOrJson(editorFormat, jsonObject)
    }, [editorFormat, traceData, rowDataPreview])

    useUpdateEffect(() => {
        if (data.length > 0) {
            setTraceData(data)
            setRowDataPreview(data[0]?.key || "")
        }
    }, [data])

    // predefind options
    const customSelectOptions = useCallback((divider = true) => {
        return [
            {value: "create", label: "Create New"},
            ...(divider
                ? [
                      {
                          value: "divider",
                          label: <Divider className="!my-1" />,
                          className: "!p-0 !m-0 !min-h-0.5 !cursor-default",
                          disabled: true,
                      },
                  ]
                : []),
        ]
    }, [])

    const onTestsetOptionChange = async (option: {label: string; value: string}) => {
        const {value, label} = option

        try {
            resetStates()
            if (value && value !== "create") {
                const data = await fetchTestset(value)
                if (data?.csvdata?.length) {
                    const testsetColumns = Object.keys(data.csvdata[0])
                    setSelectedTestsetColumns(() =>
                        testsetColumns.map((data) => ({column: data, isNew: false})),
                    )
                    setSelectedTestsetRows(data.csvdata)
                }
            }

            setTestset({name: label, id: value})
        } catch (error) {
            message.error("Failed to load Test sets!")
        }
    }

    const onRemoveTraceData = () => {
        const removeTrace = traceData.filter((trace) => trace.key !== rowDataPreview)
        setTraceData(removeTrace)

        if (removeTrace.length > 0) {
            const currentIndex = traceData.findIndex((trace) => trace.key === rowDataPreview)
            // [currentIndex]: Next option in list | [currentIndex - 1]: Previous option if next doesn't exist | [0]: Default to first option
            const nextPreview =
                removeTrace[currentIndex] || removeTrace[currentIndex - 1] || removeTrace[0]

            setRowDataPreview(nextPreview.key)

            if (rowDataPreview === preview.key) {
                onPreviewOptionChange(nextPreview.key)
            }
        } else {
            setRowDataPreview("")
        }
    }

    const mappingOptions = useMemo(() => {
        const uniquePaths = new Set<string>()

        traceData.forEach((traceItem) => {
            const traceKeys = collectKeyPathsFromObject(traceItem?.data, "data")
            traceKeys.forEach((key) => uniquePaths.add(key))
        })

        const mappedData = Array.from(uniquePaths).map((item) => ({value: item}))

        if (mappedData.length > 0 && testset.id) {
            setMappingData((prevMappingData) => {
                const testsetColumnsSet = new Set(
                    selectedTestsetColumns.map((item) => item.column.toLowerCase()),
                )

                const newMappedData = mappedData.map((item, index) => {
                    const mapName = item.value.split(".").pop()!.toLowerCase()

                    let matchingColumn = mapName
                    if (testsetColumnsSet.has(mapName)) {
                        matchingColumn = selectedTestsetColumns.find(
                            (col) => col.column.toLowerCase() === mapName,
                        )!.column
                    } else if (mapName === "outputs" && testsetColumnsSet.has("correct_answer")) {
                        matchingColumn = selectedTestsetColumns.find(
                            (col) => col.column.toLowerCase() === "correct_answer",
                        )!.column
                    }

                    return {
                        ...prevMappingData[index],
                        data: item.value,
                        column: matchingColumn,
                    }
                })

                // Efficiently update selected columns
                const updatedColumns = new Set([
                    ...selectedTestsetColumns.map((col) => col.column),
                    ...newMappedData
                        .filter((item) => !testsetColumnsSet.has(item.column.toLowerCase()))
                        .map((item) => item.column),
                ])

                setSelectedTestsetColumns(
                    Array.from(updatedColumns).map((column) => ({
                        column,
                        isNew: !testsetColumnsSet.has(column.toLowerCase()),
                    })),
                )

                return newMappedData
            })
        }

        return mappedData
    }, [traceData, testset])

    const columnOptions = useMemo(() => {
        return selectedTestsetColumns?.map(({column}) => ({
            value: column,
            lable: column,
        }))
    }, [mappingData, selectedTestsetColumns])

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
            newTestsetData = mapAndConvertDataInCsvFormat(traceData, "preview")
        } else {
            const selectedTraceData = traceData.filter((trace) => trace.key === value)
            newTestsetData = mapAndConvertDataInCsvFormat(selectedTraceData, "preview")
        }

        setPreview({key: value, data: newTestsetData})
    }

    useUpdateEffect(() => {
        const duplicatesExist = hasDuplicateColumnNames()
        setHasDuplicateColumns(duplicatesExist)

        if (!duplicatesExist && isMapColumnExist) {
            onPreviewOptionChange(preview.key)
        }
    }, [mappingData])

    const resetStates = () => {
        setSelectedTestsetColumns([])
        setSelectedTestsetRows([])
        setShowLastFiveRows(false)
        setMappingData((prev) => prev.map((item) => ({...item, column: "", newColumn: ""})))
        setPreview({key: traceData[0]?.key || "", data: []})
        setNewTestsetName("")
    }

    const mapAndConvertDataInCsvFormat = useCallback(
        (traceData: TestsetTraceData[], type: "preview" | "export") => {
            const formattedData = traceData.map((item) => {
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

                for (const {column, isNew} of selectedTestsetColumns) {
                    if (!(column in formattedItem) && !isNew) {
                        formattedItem[column] = ""
                    }
                }

                return formattedItem
            })

            if (type === "export" && !isNewTestset) {
                // add all previous test cases
                const allKeys = Array.from(
                    new Set(formattedData.flatMap((item) => Object.keys(item))),
                )

                selectedTestsetRows.forEach((row) => {
                    const formattedRow: Record<string, any> = {}
                    for (const key of allKeys) {
                        formattedRow[key] = row[key] ?? ""
                    }

                    formattedData.push(formattedRow)
                })
            }

            return formattedData
        },
        [mappingData, selectedTestsetColumns, selectedTestsetRows, isNewTestset],
    )

    const onSaveTestset = async () => {
        try {
            setIsLoading(true)

            const newTestsetData = mapAndConvertDataInCsvFormat(traceData, "export")

            if (isNewTestset) {
                if (!newTestsetName) {
                    message.error("Please add a Test set name before saving it")
                    return
                }

                await createNewTestset(newTestsetName, newTestsetData)
                message.success("Test set created successfully")
            } else {
                await updateTestset(testset.id as string, testset.name, newTestsetData)
                message.success("Test set updated successfully")
            }

            mutate()
            onClose()
            setIsConfirmSave(false)
        } catch (error) {
            console.log(error)
            message.error("Something went wrong. Please try again later")
        } finally {
            setIsLoading(false)
        }
    }

    const hasDuplicateColumnNames = useCallback(() => {
        const seenValues = new Set<string>()

        return mappingData.some((item) => {
            const columnValues = [item.column, item.newColumn]
                .filter(Boolean)
                .filter((value) => value !== "create")

            return columnValues.some((value) => {
                if (seenValues.has(value as string)) return true
                seenValues.add(value as string)
                return false
            })
        })
    }, [mappingData])

    const tableColumns = useMemo(() => {
        const mappedColumns = mappingData.map((data, idx) => {
            const columnData =
                data.column === "create" || !data.column ? data.newColumn : data.column

            return {
                title: columnData,
                dataIndex: columnData,
                key: idx,
                width: 250,
                onHeaderCell: () => ({style: {minWidth: 200}}),
            }
        })

        const testsetColumns = showLastFiveRows
            ? selectedTestsetColumns.map((item) => ({
                  title: item.column,
                  dataIndex: item.column,
                  key: item.column,
                  width: 250,
                  onHeaderCell: () => ({style: {minWidth: 200}}),
              }))
            : []

        // Remove duplicate columns and filter out columns without dataIndex
        return [...mappedColumns, ...testsetColumns].filter(
            (column, index, self) =>
                column.dataIndex &&
                self.findIndex((c) => c.dataIndex === column.dataIndex) === index,
        )
    }, [mappingData, selectedTestsetColumns, showLastFiveRows])

    const onSaveEditedTrace = () => {
        if (updatedTraceData && updatedTraceData !== formatDataPreview) {
            try {
                const newTrace = traceData.map((trace) => {
                    if (trace.key === rowDataPreview) {
                        const parsedUpdatedData =
                            typeof updatedTraceData === "string"
                                ? editorFormat === "YAML"
                                    ? yaml.load(updatedTraceData)
                                    : JSON.parse(updatedTraceData)
                                : updatedTraceData

                        const updatedDataString = getYamlOrJson(editorFormat, parsedUpdatedData)
                        const originalDataString = getYamlOrJson(editorFormat, {
                            data: trace.originalData || trace.data,
                        })
                        const isMatchingOriginalData = updatedDataString == originalDataString
                        const isMatchingData =
                            updatedDataString !== getYamlOrJson(editorFormat, {data: trace.data})

                        if (isMatchingOriginalData) {
                            return {
                                ...trace,
                                ...parsedUpdatedData,
                                isEdited: false,
                                originalData: null,
                            }
                        } else {
                            return {
                                ...trace,
                                ...parsedUpdatedData,
                                ...(isMatchingData && !trace.originalData
                                    ? {originalData: trace.data}
                                    : {}),
                                isEdited: true,
                            }
                        }
                    }
                    return trace
                })

                // Only update if there are actual changes
                setTraceData((prevTraceData) =>
                    JSON.stringify(prevTraceData) !== JSON.stringify(newTrace)
                        ? newTrace
                        : prevTraceData,
                )
            } catch (error) {
                message.error(
                    editorFormat === "YAML" ? "Invalid YAML format" : "Invalid JSON format",
                )
            }
        }
    }

    return (
        <>
            <GenericDrawer
                {...props}
                destroyOnClose={false}
                onClose={() => {
                    onClose()
                    setUpdatedTraceData("")
                    setNewTestsetName("")
                    setHasDuplicateColumns(false)
                }}
                expandable
                initialWidth={640}
                headerExtra="Add to test set"
                footer={
                    <div className="flex justify-end items-center gap-2 py-2 px-3">
                        <Button onClick={onClose}>Cancel</Button>
                        <Button
                            type="primary"
                            loading={isLoading || isTestsetsLoading}
                            onClick={() =>
                                !isNewTestset && isNewColumnCreated
                                    ? setIsConfirmSave(true)
                                    : onSaveTestset()
                            }
                            disabled={!testset.name || !isMapColumnExist || hasDuplicateColumns}
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
                                        ...customSelectOptions(listOfTestsets.length > 0),
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
                                            value={newTestsetName}
                                            onChange={(e) => setNewTestsetName(e.target.value)}
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
                                    value={rowDataPreview}
                                    onChange={(value) => {
                                        setRowDataPreview(value)
                                        setUpdatedTraceData("")
                                    }}
                                >
                                    {traceData.map((trace) => (
                                        <Select.Option value={trace?.key} key={trace?.key}>
                                            Span {trace.id}{" "}
                                            {trace.isEdited && (
                                                <span className={classes.customTag}>(edited)</span>
                                            )}
                                        </Select.Option>
                                    ))}
                                </Select>
                                <div className="flex justify-between items-center gap-2">
                                    {traceData.length > 1 && (
                                        <Button
                                            variant="text"
                                            color="danger"
                                            icon={<Trash size={14} />}
                                            onClick={onRemoveTraceData}
                                        >
                                            Remove span {selectedTraceData?.id}
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
                            <div className="relative">
                                <Editor
                                    className={clsx([
                                        classes.editor,
                                        selectedTraceData?.isEdited && "!border-blue-400",
                                    ])}
                                    height={210}
                                    language={editorFormat.toLowerCase()}
                                    theme={`vs-${appTheme}`}
                                    value={formatDataPreview}
                                    onChange={(value) => setUpdatedTraceData(value as string)}
                                    options={{
                                        wordWrap: "on",
                                        minimap: {enabled: false},
                                        scrollBeyondLastLine: false,
                                        readOnly: false,
                                        lineNumbers: "off",
                                        lineDecorationsWidth: 0,
                                        scrollbar: {
                                            verticalScrollbarSize: 4,
                                            horizontalScrollbarSize: 4,
                                        },
                                    }}
                                />
                                {updatedTraceData && updatedTraceData !== formatDataPreview ? (
                                    <Button
                                        icon={<FloppyDiskBack size={14} />}
                                        className="absolute top-2 right-2"
                                        onClick={onSaveEditedTrace}
                                    />
                                ) : null}
                            </div>
                        </div>

                        <div className={classes.container}>
                            <Typography.Text
                                className={classes.label}
                                type={hasDuplicateColumns ? "danger" : "secondary"}
                            >
                                Mapping
                            </Typography.Text>
                            {hasDuplicateColumns && (
                                <Typography.Text type="danger">
                                    Duplicate columns detected. Ensure each column is unique
                                </Typography.Text>
                            )}

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
                                                    placeholder="Select a mapped data key"
                                                    value={data.data || undefined}
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
                                                    <Select
                                                        style={{width: "100%"}}
                                                        placeholder="Select a column"
                                                        value={data.column || undefined}
                                                        onChange={(value) =>
                                                            onMappingOptionChange({
                                                                pathName: "column",
                                                                value,
                                                                idx,
                                                            })
                                                        }
                                                        options={[
                                                            ...(testset.id
                                                                ? customSelectOptions(
                                                                      selectedTestsetColumns.length >
                                                                          0,
                                                                  )
                                                                : []),
                                                            ...columnOptions,
                                                        ]}
                                                    />

                                                    {data.column === "create" && (
                                                        <AutoComplete
                                                            style={{width: "100%"}}
                                                            options={columnOptions}
                                                            onSelect={(value) =>
                                                                onMappingOptionChange({
                                                                    pathName: "newColumn",
                                                                    value,
                                                                    idx,
                                                                })
                                                            }
                                                            onChange={(value) =>
                                                                onMappingOptionChange({
                                                                    pathName: "newColumn",
                                                                    value,
                                                                    idx,
                                                                })
                                                            }
                                                            placeholder="Column name"
                                                            filterOption={(inputValue, option) =>
                                                                option!.value
                                                                    .toUpperCase()
                                                                    .indexOf(
                                                                        inputValue.toUpperCase(),
                                                                    ) !== -1
                                                            }
                                                        />
                                                    )}
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
                                            setMappingData([...mappingData, {data: "", column: ""}])
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
                                                Show last {selectedTestsetTestCases.length} test
                                                cases in test set
                                            </Checkbox>
                                        )}
                                    </div>

                                    <div>
                                        <Table
                                            className="ph-no-capture"
                                            columns={tableColumns}
                                            dataSource={[
                                                ...preview.data,
                                                ...(showLastFiveRows
                                                    ? selectedTestsetTestCases
                                                    : []),
                                            ]}
                                            rowClassName={(_, index) => {
                                                if (showLastFiveRows) {
                                                    const totalRows =
                                                        preview.data.length +
                                                        selectedTestsetTestCases.length

                                                    if (
                                                        index >=
                                                        totalRows - selectedTestsetTestCases.length
                                                    ) {
                                                        return "!bg-[#fafafa]"
                                                    }
                                                }
                                                return ""
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

                        {isConfirmSave && (
                            <Modal
                                open={isConfirmSave}
                                onCancel={() => setIsConfirmSave(false)}
                                title="Are you sure you want to save?"
                                okText={"Confirm"}
                                onOk={() => onSaveTestset()}
                                confirmLoading={isLoading || isTestsetsLoading}
                                zIndex={2000}
                                centered
                            >
                                <div className="flex flex-col gap-4 my-4">
                                    <Typography.Text>
                                        You have created new columns. Do you want to add them to the
                                        <span className="font-bold">{testset.name}</span> test set?
                                    </Typography.Text>

                                    <div className="flex gap-1">
                                        New columns:{" "}
                                        {JSON.stringify(
                                            selectedTestsetColumns
                                                .filter((item) => item.isNew)
                                                .map((item) => item.column),
                                        )}
                                    </div>
                                </div>
                            </Modal>
                        )}
                    </section>
                }
            />
        </>
    )
}

export default TestsetDrawer
