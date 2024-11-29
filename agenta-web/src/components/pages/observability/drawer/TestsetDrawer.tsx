import GenericDrawer from "@/components/GenericDrawer"
import {ArrowRight, Copy, PencilSimple, Plus, Trash} from "@phosphor-icons/react"
import {Button, Checkbox, Divider, Input, Radio, Select, Table, Typography} from "antd"
import React, {useState} from "react"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {Editor} from "@monaco-editor/react"
import {createUseStyles} from "react-jss"
import {JSSTheme, KeyValuePair, testset} from "@/lib/Types"
import {fetchTestset, useLoadTestsetsList} from "@/services/testsets/api"

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

const TestsetDrawer = ({open, setOpen}: any) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    // testset
    const {testsets, isTestsetsLoading} = useLoadTestsetsList()
    const [isNewTestset, setIsNewTestset] = useState(false)
    const [testset, setTestset] = useState({name: "", id: ""})
    const [testsetName, setTestsetName] = useState("")
    // table
    const [tableColumns, setTableColumns] = useState([])
    const [tableRows, setTableRows] = useState<KeyValuePair[]>([])
    const [isShowlastFiveRows, setIsShowlastFiveRows] = useState(false)
    // others
    const [formatType, setFormatType] = useState("json")

    // predifind options
    const customSelectOptions = [
        {value: "create", label: "Create New Test set"},
        {
            value: "divider",
            label: <Divider className="!my-1" />,
            className: "!p-0 !m-0 !min-h-0.5 !cursor-default",
            disabled: true,
        },
    ]

    const handleChange = (value: string) => {}

    const onTestsetOptionChange = async (option: any) => {
        if (option.value === "create") {
            setIsNewTestset(true)
        } else {
            setIsNewTestset(false)
        }

        setTestset({name: option.lable, id: option.value})

        if (option.value && option.value !== "create") {
            // fetch testset detailes and assign the columns and rows
            const data = await fetchTestset(option.value)

            if (data) {
                setTableColumns(Object.keys(data.csvdata[0]) as any)
                setTableRows(data.csvdata.slice(-5))
            }
        }
    }

    const Content = () => {
        return (
            <section className="w-full flex flex-col gap-6">
                <Typography.Text className={classes.drawerHeading}>
                    Spans selected 65
                </Typography.Text>

                <div className={classes.container}>
                    <Typography.Text className={classes.label}>Test set</Typography.Text>
                    <div className="flex gap-2">
                        <Select
                            showSearch
                            labelInValue
                            style={{width: 200}}
                            placeholder="Select Test set"
                            value={{lable: testset.name, value: testset.id}}
                            onChange={onTestsetOptionChange}
                            options={[
                                ...customSelectOptions,
                                ...testsets.map((item: testset) => ({
                                    value: item._id,
                                    label: item.name,
                                })),
                            ]}
                            loading={isTestsetsLoading}
                        />

                        {isNewTestset && (
                            <div className="relative">
                                <Input
                                    style={{width: 200}}
                                    value={testsetName}
                                    onChange={(e) => setTestsetName(e.target.value)}
                                    placeholder="Test set name"
                                />
                                <PencilSimple size={14} className="absolute top-[8px] right-2" />
                            </div>
                        )}
                    </div>
                </div>

                <div className={classes.container}>
                    <Typography.Text className={classes.label}>Data preview</Typography.Text>

                    <div className="flex justify-between items-center mb-2">
                        <Select
                            style={{width: 200}}
                            onChange={handleChange}
                            options={[
                                {value: "jack", label: "Jack"},
                                {value: "lucy", label: "Lucy"},
                            ]}
                        />
                        <div className="flex justify-between items-center gap-2">
                            <Radio.Group
                                options={[
                                    {label: "JSON", value: "json"},
                                    {label: "YAML", value: "yaml"},
                                ]}
                                onChange={(e) => setFormatType(e.target.value)}
                                value={formatType}
                                optionType="button"
                            />
                            <Button icon={<Copy size={16} />} />
                        </div>
                    </div>

                    <Editor
                        className={classes.editor}
                        height={210}
                        language={"json"}
                        theme={`vs-${appTheme}`}
                        value={"JSON"}
                        options={{
                            wordWrap: "on",
                            minimap: {enabled: false},
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
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
                    <div className="flex flex-col gap-2">
                        {[1, 2].map((_, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2">
                                <Select
                                    style={{width: 200}}
                                    onChange={handleChange}
                                    options={[
                                        {value: "jack", label: "Jack"},
                                        {value: "lucy", label: "Lucy"},
                                    ]}
                                />
                                <ArrowRight size={16} />
                                <Select
                                    style={{width: 320}}
                                    onChange={handleChange}
                                    options={tableColumns?.map((column) => ({
                                        value: column,
                                        lable: column,
                                    }))}
                                />
                                <Button icon={<Trash />} />
                            </div>
                        ))}
                    </div>

                    <Button type="dashed" className="mt-1" style={{width: 200}} icon={<Plus />}>
                        Add field
                    </Button>
                </div>

                <div className={classes.container}>
                    <Typography.Text className={classes.label}>Preview</Typography.Text>
                    {tableColumns ? (
                        <>
                            <div className="flex items-center gap-4 mb-2">
                                <Select
                                    style={{width: 200}}
                                    onChange={handleChange}
                                    options={[
                                        {value: "jack", label: "Jack"},
                                        {value: "lucy", label: "Lucy"},
                                    ]}
                                />
                                <Checkbox
                                    onChange={() => setIsShowlastFiveRows(!isShowlastFiveRows)}
                                    checked={isShowlastFiveRows}
                                >
                                    Show last 5 test set entries
                                </Checkbox>
                            </div>

                            <div>
                                <Table
                                    className="ph-no-capture"
                                    columns={tableColumns.map((column, idx) => ({
                                        title: column,
                                        dataIndex: column,
                                        key: idx,
                                        onHeaderCell: () => ({
                                            style: {minWidth: 160},
                                        }),
                                    }))}
                                    dataSource={isShowlastFiveRows ? tableRows : []}
                                    scroll={{x: true}}
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
        )
    }
    return (
        <>
            <GenericDrawer
                open={open}
                onClose={() => setOpen(false)}
                expandable
                drawerWidth={640}
                headerExtra="Add to test set"
                mainContent={<Content />}
            />
        </>
    )
}

export default TestsetDrawer
