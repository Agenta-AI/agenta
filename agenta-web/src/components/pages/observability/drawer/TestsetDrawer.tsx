import GenericDrawer from "@/components/GenericDrawer"
import {ArrowRight, Copy, PencilSimple, Plus, Trash} from "@phosphor-icons/react"
import {Button, Checkbox, Divider, DrawerProps, Input, Radio, Select, Table, Typography} from "antd"
import React, {useState} from "react"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {Editor} from "@monaco-editor/react"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"

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
    const [isNewTestset, setIsNewTestset] = useState(false)
    const [testset, setTestset] = useState("")
    const [testsetName, setTestsetName] = useState("")
    const [formatType, setFormatType] = useState("json")

    const onClose = () => {
        setOpen(false)
    }

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

    const onTestsetOptionChange = (value: string) => {
        if (value === "create") {
            setIsNewTestset(true)
        } else {
            setIsNewTestset(false)
        }
        setTestset(value)
    }

    const testsetOptions = [
        ...customSelectOptions,
        {value: "jack", label: "Jack"},
        {value: "lucy", label: "Lucy"},
    ]

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
                            style={{width: 200}}
                            placeholder="Select Test set"
                            value={testset}
                            onChange={onTestsetOptionChange}
                            options={testsetOptions}
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
                        {[1, 2].map(() => (
                            <div className="flex items-center justify-between gap-2">
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
                                    options={[
                                        {value: "jack", label: "Jack"},
                                        {value: "lucy", label: "Lucy"},
                                    ]}
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
                    <div className="flex items-center gap-4 mb-2">
                        <Select
                            style={{width: 200}}
                            onChange={handleChange}
                            options={[
                                {value: "jack", label: "Jack"},
                                {value: "lucy", label: "Lucy"},
                            ]}
                        />
                        <Checkbox>Show last 5 test set entries</Checkbox>
                    </div>

                    <div>
                        <Table
                            className="ph-no-capture"
                            columns={[
                                {
                                    title: "country",
                                    dataIndex: "country",
                                    key: "country",
                                    onHeaderCell: () => ({
                                        style: {minWidth: 160},
                                    }),
                                },
                                {
                                    title: "ground_truth",
                                    dataIndex: "ground_truth",
                                    key: "ground_truth",
                                    onHeaderCell: () => ({
                                        style: {minWidth: 160},
                                    }),
                                },

                                {
                                    title: "flag",
                                    dataIndex: "flag",
                                    key: "flag",
                                    onHeaderCell: () => ({
                                        style: {minWidth: 160},
                                    }),
                                },
                            ]}
                            // dataSource={evaluationsList}
                            scroll={{x: true}}
                            bordered
                            pagination={false}
                        />
                    </div>
                </div>
            </section>
        )
    }
    return (
        <>
            <GenericDrawer
                open={open}
                onClose={onClose}
                expandable
                drawerWidth={640}
                headerExtra="Add to test set"
                mainContent={<Content />}
            />
        </>
    )
}

export default TestsetDrawer
