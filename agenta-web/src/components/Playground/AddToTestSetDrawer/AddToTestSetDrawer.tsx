import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {useAppTheme} from "../../Layout/ThemeContextProvider"
import {testset} from "@/lib/Types"
import {renameVariables} from "@/lib/helpers/utils"
import {createNewTestset, loadTestset, updateTestset, useLoadTestsetsList} from "@/lib/services/api"
import {Button, Drawer, Form, Input, Modal, Select, Typography, message} from "antd"
import {useRouter} from "next/router"
import React, {useCallback, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {useUpdateEffect} from "usehooks-ts"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    footer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "0.75rem",
    },
    selector: ({themeMode}: StyleProps) => ({
        minWidth: 160,
        "& .ant-select-selection-placeholder": {
            color: themeMode === "dark" ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.88)",
        },
    }),
})

type Props = React.ComponentProps<typeof Drawer> & {
    params: Record<string, string>
}

const AddToTestSetDrawer: React.FC<Props> = ({params, ...props}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [form] = Form.useForm()
    const [selectedTestset, setSelectedTestset] = useState<string>()
    const [newTesetModalOpen, setNewTestsetModalOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const dirty = useRef(false)
    const router = useRouter()
    const appId = router.query.app_id as string
    const isNew = selectedTestset === "-1"

    const {testsets, mutate, isTestsetsLoading, isTestsetsLoadingError} = useLoadTestsetsList(appId)

    // reset the form to load latest initialValues on drawer open
    useUpdateEffect(() => {
        if (props.open) {
            mutate()
            form.resetFields()
        } else dirty.current = false
    }, [props.open])

    const onClose = useCallback(() => {
        if (dirty.current) {
            AlertPopup({
                title: "Unsaved changes",
                message:
                    "You have unsaved changes in your form that will be lost. Do you still want to close it?",
                onOk: props.onClose,
            })
        } else {
            props.onClose?.({} as any)
        }
    }, [props.onClose])

    const addToTestSet = useCallback(
        (name: string, csvdata: Record<string, string>[], rowData: Record<string, string>) => {
            setLoading(true)

            const newRow: (typeof csvdata)[0] = {}
            if (!isNew) {
                Object.keys(csvdata?.[0] || {}).forEach((col) => {
                    newRow[col] = rowData[col] || ""
                })
            }

            const promise = isNew
                ? createNewTestset(appId, name, [rowData])
                : updateTestset(selectedTestset!, name, [...csvdata, newRow])
            promise
                .then(() => {
                    message.success(`Row added to the "${name}" test set!`)
                    props.onClose?.({} as any)
                })
                .finally(() => setLoading(false))
        },
        [selectedTestset, props.onClose],
    )

    const onFinish = useCallback(
        (values: any) => {
            if (isNew) {
                setNewTestsetModalOpen(true)
            } else {
                loadTestset(selectedTestset!).then((data) => {
                    const testsetCols = Object.keys(data.csvdata?.[0] || {})
                    const playgroundCols = Object.keys(values)
                    const missingColsTestset = testsetCols.filter(
                        (col) => !playgroundCols.includes(col),
                    )
                    const missingColsPlayground = playgroundCols.filter(
                        (col) => !testsetCols.includes(col),
                    )

                    // if cols mismatch (playground cols not a superset of testset cols)
                    if (missingColsTestset.length) {
                        AlertPopup({
                            type: "error",
                            title: "Columns mismatch",
                            message: (
                                <span>
                                    Can't add to the selected test set, because its column(s) don't
                                    match with the playground parameters.
                                    <br />
                                    <br />
                                    <b>Test set Columns:</b> {testsetCols.join(", ")}
                                    <br />
                                    <br />
                                    <b>Playground Parameters:</b> {playgroundCols.join(", ")}
                                </span>
                            ),
                            cancelText: null,
                            okText: "Ok",
                        })
                    }
                    // if unmapped cols (playground has cols that don't map to testset cols)
                    else if (missingColsPlayground.length) {
                        AlertPopup({
                            type: "confirm",
                            title: "Unmapped parameters",
                            message: (
                                <span>
                                    Following parameters from the playground can't map to any
                                    columns of the selected test set:{" "}
                                    <strong>{missingColsPlayground.join(", ")}</strong>
                                    <br />
                                    <br />
                                    Do you want to ignore these unmapped parameters and continue
                                    adding to the test set?
                                </span>
                            ),
                            okText: "Add",
                            onOk: () => addToTestSet(data.name, data.csvdata, values),
                        })
                    }
                    // exact match b/w playground cols and testset cols
                    else {
                        addToTestSet(data.name, data.csvdata, values)
                    }
                })
            }
        },
        [selectedTestset],
    )

    return (
        <Drawer
            title="Add to Test Set"
            size="large"
            footer={
                <div className={classes.footer}>
                    <Select
                        placeholder="Select Test Set"
                        className={classes.selector}
                        value={selectedTestset}
                        onChange={setSelectedTestset}
                        loading={isTestsetsLoading || isTestsetsLoadingError}
                        options={[
                            {
                                value: "-1",
                                label: <Typography.Link>+ Add new</Typography.Link>,
                            },
                            ...(testsets || []).map((item: testset) => ({
                                label: item.name,
                                value: item._id,
                            })),
                        ]}
                    />
                    <Button
                        type="primary"
                        disabled={!selectedTestset}
                        loading={loading}
                        onClick={form.submit}
                    >
                        Add
                    </Button>
                </div>
            }
            {...props}
            onClose={onClose}
        >
            <Form
                onValuesChange={() => (dirty.current = true)}
                form={form}
                initialValues={params}
                layout="vertical"
                onFinish={onFinish}
            >
                {Object.keys(params).map((name) => (
                    <Form.Item key={name} label={renameVariables(name)} name={name}>
                        <Input.TextArea autoSize={{minRows: 3, maxRows: 8}} />
                    </Form.Item>
                ))}
            </Form>
            <AddNewTestsetModal
                open={newTesetModalOpen}
                onCancel={() => setNewTestsetModalOpen(false)}
                destroyOnClose
                onSubmit={(name) => addToTestSet(name, [], form.getFieldsValue())}
            />
        </Drawer>
    )
}

export default AddToTestSetDrawer

const AddNewTestsetModal: React.FC<
    React.ComponentProps<typeof Modal> & {onSubmit: (name: string) => void}
> = ({onSubmit, ...props}) => {
    const [form] = Form.useForm()

    useUpdateEffect(() => {
        if (props.open) form.resetFields()
    }, [props.open])

    const onFinish = useCallback(
        ({name}: {name: string}) => {
            props.onCancel?.({} as any)
            onSubmit(name)
        },
        [onSubmit, props.onCancel],
    )

    return (
        <Modal title="Add new test set" okText="Submit" onOk={form.submit} {...props}>
            <Form form={form} onFinish={onFinish}>
                <Form.Item
                    rules={[{required: true, message: "Please enter test set name!"}]}
                    name="name"
                >
                    <Input placeholder="Test set name" />
                </Form.Item>
            </Form>
        </Modal>
    )
}
