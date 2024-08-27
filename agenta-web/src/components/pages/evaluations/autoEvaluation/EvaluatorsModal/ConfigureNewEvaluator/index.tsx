import {Evaluator, JSSTheme, Variant} from "@/lib/Types"
import {CloseOutlined} from "@ant-design/icons"
import {
    ArrowLeft,
    CaretDoubleLeft,
    CaretDoubleRight,
    ClockClockwise,
    Database,
    Lightning,
    Play,
} from "@phosphor-icons/react"
import {Button, Divider, Flex, Form, Input, Space, Tag, Typography} from "antd"
import React, {useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import AdvancedSettings from "./AdvancedSettings"
import {DynamicFormField} from "./DynamicFormField"
import EvaluatorVariantModal from "./EvaluatorVariantModal"

type ConfigureNewEvaluatorProps = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    handleOnCancel: () => void
    selectedEvaluator: Evaluator
    variants: Variant[] | null
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    headerText: {
        "& .ant-typography": {
            lineHeight: theme.lineHeightLG,
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightStrong,
        },
    },
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightLG,
    },
    formContainer: {
        display: "flex",
        flexDirection: "column",
        gap: theme.padding,
        overflowY: "auto",
        maxHeight: 580,
        "& .ant-form-item": {
            marginBottom: 0,
        },
    },
}))

const ConfigureNewEvaluator = ({
    setCurrent,
    selectedEvaluator,
    handleOnCancel,
    variants,
}: ConfigureNewEvaluatorProps) => {
    const classes = useStyles()
    const [form] = Form.useForm()
    const [debugEvaluator, setDebugEvaluator] = useState(false)
    const [openVariantModal, setOpenVariantModal] = useState(false)

    const evalFields = useMemo(
        () =>
            Object.keys(selectedEvaluator?.settings_template || {})
                .filter((key) => !!selectedEvaluator?.settings_template[key]?.type)
                .map((key) => ({
                    key,
                    ...selectedEvaluator?.settings_template[key]!,
                    advanced: selectedEvaluator?.settings_template[key]?.advanced || false,
                })),
        [selectedEvaluator],
    )

    const advancedSettingsFields = evalFields.filter((field) => field.advanced)
    const basicSettingsFields = evalFields.filter((field) => !field.advanced)

    const onSubmit = () => {
        try {
        } catch (error: any) {}
    }

    return (
        <div className="flex flex-col gap-6 h-full">
            <div className="flex items-center justify-between">
                <Space className={classes.headerText}>
                    <Button
                        icon={<ArrowLeft size={14} />}
                        className="flex items-center justify-center"
                        onClick={() => setCurrent(1)}
                    />
                    <Typography.Text>Step 2/2:</Typography.Text>
                    <Typography.Text>Configure new evaluator</Typography.Text>
                    <Tag>{selectedEvaluator.name}</Tag>
                </Space>

                <Button onClick={handleOnCancel} type="text" icon={<CloseOutlined />} />
            </div>

            <Flex gap={16} className="h-full">
                <div className="flex-1 flex flex-col gap-4">
                    <div>
                        <Flex justify="space-between">
                            <Typography.Text className={classes.title}>
                                {selectedEvaluator.name}
                            </Typography.Text>
                            <Space>
                                <Button
                                    size="small"
                                    className="flex items-center gap-2"
                                    disabled={true}
                                >
                                    <ClockClockwise />
                                    View history
                                </Button>
                                <Button
                                    size="small"
                                    onClick={() => setDebugEvaluator(!debugEvaluator)}
                                >
                                    {debugEvaluator ? (
                                        <div className="flex items-center gap-2">
                                            Debug
                                            <CaretDoubleRight />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <CaretDoubleLeft />
                                            Debug
                                        </div>
                                    )}
                                </Button>
                            </Space>
                        </Flex>
                        <Typography.Text type="secondary">
                            {selectedEvaluator.description}
                        </Typography.Text>
                    </div>

                    <div className="flex-1">
                        <Form
                            requiredMark={false}
                            form={form}
                            name="new-evaluator"
                            onFinish={() => onSubmit}
                            layout="vertical"
                            className={classes.formContainer}
                        >
                            <Form.Item
                                name="name"
                                label="Name"
                                rules={[{required: true, message: "This field is required"}]}
                            >
                                <Input data-cy="configure-new-evaluator-modal-input" />
                            </Form.Item>

                            {basicSettingsFields.map((field) => (
                                <DynamicFormField
                                    {...field}
                                    key={field.key}
                                    name={["settings_values", field.key]}
                                />
                            ))}

                            {advancedSettingsFields.length > 0 && (
                                <AdvancedSettings settings={advancedSettingsFields} />
                            )}
                        </Form>
                    </div>

                    <Flex gap={8} justify="end">
                        <Button type="text">Reset</Button>
                        <Button type="primary">Save configuration</Button>
                    </Flex>
                </div>

                {debugEvaluator && (
                    <>
                        <Divider type="vertical" className="h-full" />

                        <div className="flex-1 flex flex-col gap-4">
                            <Space direction="vertical" size={0}>
                                <Typography.Text className={classes.title}>
                                    Debug evaluator
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                    Test your evaluator by generating a test data
                                </Typography.Text>
                            </Space>

                            <Flex justify="space-between">
                                <Typography.Text className={classes.title}>
                                    Generate test data
                                </Typography.Text>
                                <Space>
                                    <Button size="small" className="flex items-center gap-2">
                                        <Database />
                                        Load test case
                                    </Button>
                                    <Button
                                        size="small"
                                        className="flex items-center gap-2"
                                        onClick={() => setOpenVariantModal(true)}
                                    >
                                        <Lightning />
                                        Select variant
                                    </Button>
                                    <Button size="small" className="flex items-center gap-2">
                                        <Play />
                                        Run variant
                                    </Button>
                                </Space>
                            </Flex>

                            <div className="flex-1 flex flex-col h-full">
                                <Typography.Text>JSON</Typography.Text>
                                <Input.TextArea className="h-full flex-1" placeholder="Textarea" />
                            </div>

                            <div className="flex flex-col gap-2">
                                <Flex justify="space-between">
                                    <Typography.Text>Output</Typography.Text>
                                    <Button className="flex items-center gap-2" size="small">
                                        <Play /> Run evaluator
                                    </Button>
                                </Flex>

                                <Input.TextArea
                                    className="h-full flex-1"
                                    placeholder="Result"
                                    autoSize={{minRows: 4}}
                                />
                            </div>
                        </div>
                    </>
                )}
            </Flex>

            <EvaluatorVariantModal
                variants={variants}
                open={openVariantModal}
                onCancel={() => setOpenVariantModal(false)}
            />
        </div>
    )
}

export default ConfigureNewEvaluator
