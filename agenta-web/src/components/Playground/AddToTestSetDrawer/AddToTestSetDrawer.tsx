import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {useAppTheme} from "../../Layout/ThemeContextProvider"
import {ChatMessage, ChatRole, GenericObject, testset} from "@/lib/Types"
import {removeKeys, renameVariables} from "@/lib/helpers/utils"
import {createNewTestset, loadTestset, updateTestset, useLoadTestsetsList} from "@/lib/services/api"
import {
    Button,
    Divider,
    Drawer,
    Form,
    Input,
    Modal,
    Select,
    Space,
    Switch,
    Typography,
    message,
} from "antd"
import {useRouter} from "next/router"
import React, {useCallback, useLayoutEffect, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {useUpdateEffect} from "usehooks-ts"
import ChatInputs from "@/components/ChatInputs/ChatInputs"
import _ from "lodash"

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
    chatContainer: {
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        marginBottom: "1rem",
    },
})

function flatToTurn({
    chat,
    correct_answer,
}: {
    chat?: ChatMessage[]
    correct_answer?: ChatMessage | string
}) {
    const flatChat = _.cloneDeep(chat || [])
    if (correct_answer && typeof correct_answer !== "string")
        flatChat.push(_.cloneDeep(correct_answer))

    const turns: {chat: ChatMessage[]; correct_answer: ChatMessage}[] = []
    let currentTurn: ChatMessage[] = []
    flatChat.forEach((item) => {
        if (item.role !== ChatRole.User) {
            turns.push({
                chat: _.clone(currentTurn || []),
                correct_answer: item,
            })
        }
        currentTurn.push(item)
    })
    return turns
}

function turnToFlat(turns: {chat: ChatMessage[]; correct_answer: ChatMessage}[]) {
    const flat = _.cloneDeep(turns.at(-1))
    return {
        chat: flat?.chat || [],
        correct_answer: flat?.correct_answer || "",
    }
}

type Props = React.ComponentProps<typeof Drawer> & {
    params: GenericObject
    isChatVariant: boolean
}

const AddToTestSetDrawer: React.FC<Props> = ({params, isChatVariant, ...props}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const [form] = Form.useForm()
    const [selectedTestset, setSelectedTestset] = useState<string>()
    const [newTesetModalOpen, setNewTestsetModalOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [turnModeChat, setTurnModeChat] = useState<
        {chat: ChatMessage[]; correct_answer: ChatMessage}[] | null
    >(null)
    const [shouldRender, setShouldRender] = useState(false)
    const dirty = useRef(false)
    const router = useRouter()
    const appId = router.query.app_id as string
    const isNew = selectedTestset === "-1"

    const {testsets, mutate, isTestsetsLoading, isTestsetsLoadingError} = useLoadTestsetsList(appId)
    const chatParams = useRef<{chat: ChatMessage[]; correct_answer: ChatMessage | string}>({
        chat: [],
        correct_answer: "",
    }).current

    // reset the form to load latest initialValues on drawer open
    useUpdateEffect(() => {
        if (props.open) {
            mutate()

            //reset to defaults
            form.resetFields()
            chatParams.chat = _.cloneDeep(params.chat || [])
            chatParams.correct_answer = _.cloneDeep(params.correct_answer || "")
            setTurnModeChat(null)
            setShouldRender(true)
        } else {
            dirty.current = false
            setShouldRender(false)
        }
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
        (name: string, csvdata: Record<string, string>[], rows: GenericObject[]) => {
            const newRows = rows.map((item) => {
                const row = {...item}
                if (isChatVariant) {
                    row.chat = JSON.stringify(
                        row.chat.map((item: ChatMessage) => removeKeys(item, ["id"])),
                    )
                    row.correct_answer = JSON.stringify(removeKeys(row.correct_answer, ["id"]))
                }

                setLoading(true)

                const newRow: (typeof csvdata)[0] = {}
                if (!isNew) {
                    Object.keys(csvdata?.[0] || {}).forEach((col) => {
                        newRow[col] = row[col] || ""
                    })
                }
                return isNew ? row : newRow
            })

            const promise = isNew
                ? createNewTestset(appId, name, newRows)
                : updateTestset(selectedTestset!, name, [...csvdata, ...newRows])
            promise
                .then(() => {
                    message.success(`Row added to the "${name}" test set!`)
                    props.onClose?.({} as any)
                })
                .finally(() => setLoading(false))
        },
        [selectedTestset, props.onClose, isChatVariant],
    )

    const onFinish = useCallback(
        (values: GenericObject[]) => {
            if (isNew) {
                setNewTestsetModalOpen(true)
            } else {
                loadTestset(selectedTestset!).then((data) => {
                    const testsetCols = Object.keys(data.csvdata?.[0] || {})
                    const playgroundCols = Object.keys(values[0])
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
                    {isChatVariant && (
                        <Space align="center">
                            <Typography.Text>Turn by Turn:</Typography.Text>
                            <Switch
                                checked={Array.isArray(turnModeChat)}
                                onChange={(checked) => {
                                    setTurnModeChat(checked ? flatToTurn(chatParams) : null)
                                    if (!checked && Array.isArray(turnModeChat)) {
                                        const {chat, correct_answer} = turnToFlat(turnModeChat)
                                        chatParams.chat = chat
                                        chatParams.correct_answer = correct_answer
                                    }
                                }}
                            />
                        </Space>
                    )}
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
                        onClick={
                            isChatVariant
                                ? () => {
                                      onFinish(
                                          Array.isArray(turnModeChat) ? turnModeChat : [chatParams],
                                      )
                                  }
                                : form.submit
                        }
                    >
                        Add
                    </Button>
                </div>
            }
            {...props}
            onClose={onClose}
        >
            {!shouldRender ? null : isChatVariant ? (
                Array.isArray(turnModeChat) ? (
                    turnModeChat.map((turn, index) => (
                        <div key={index}>
                            <div className={classes.chatContainer}>
                                <Typography.Text strong>Chat</Typography.Text>
                                <ChatInputs
                                    defaultValue={turn.chat}
                                    onChange={(val) => {
                                        turn.chat = val
                                        dirty.current = true
                                    }}
                                />
                            </div>

                            <div className={classes.chatContainer}>
                                <Typography.Text strong>Correct Answer</Typography.Text>
                                <ChatInputs
                                    defaultValue={[turn.correct_answer]}
                                    onChange={(val) => {
                                        turn.correct_answer = val[0]
                                        dirty.current = true
                                    }}
                                    disableAdd
                                    disableRemove
                                />
                            </div>

                            <Divider />
                        </div>
                    ))
                ) : (
                    <div>
                        <div className={classes.chatContainer}>
                            <Typography.Text strong>Chat</Typography.Text>
                            <ChatInputs
                                defaultValue={chatParams.chat}
                                onChange={(val) => {
                                    chatParams.chat = val
                                    dirty.current = true
                                }}
                            />
                        </div>

                        <div className={classes.chatContainer}>
                            <Typography.Text strong>Correct Answer</Typography.Text>
                            <ChatInputs
                                defaultValue={
                                    chatParams.correct_answer
                                        ? [chatParams.correct_answer as ChatMessage]
                                        : undefined
                                }
                                onChange={(val) => {
                                    chatParams.correct_answer = val[0]
                                    dirty.current = true
                                }}
                                disableAdd
                                disableRemove
                            />
                        </div>
                    </div>
                )
            ) : (
                <Form
                    onValuesChange={() => (dirty.current = true)}
                    form={form}
                    initialValues={params}
                    layout="vertical"
                    onFinish={(values) => onFinish([values])}
                >
                    {Object.keys(params).map((name) => (
                        <Form.Item key={name} label={renameVariables(name)} name={name}>
                            <Input.TextArea autoSize={{minRows: 3, maxRows: 8}} />
                        </Form.Item>
                    ))}
                </Form>
            )}
            <AddNewTestsetModal
                open={newTesetModalOpen}
                onCancel={() => setNewTestsetModalOpen(false)}
                destroyOnClose
                onSubmit={(name) =>
                    addToTestSet(
                        name,
                        [],
                        isChatVariant
                            ? Array.isArray(turnModeChat)
                                ? turnModeChat
                                : [chatParams]
                            : [form.getFieldsValue()],
                    )
                }
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
