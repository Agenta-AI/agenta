import {useAppId} from "@/hooks/useAppId"
import {JSSTheme, Variant, testset} from "@/lib/Types"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {fetchTestsets, fetchVariants} from "@/lib/services/api"
import {CreateAnnotationData, createAnnotation} from "@/services/annotations"
import {PlusOutlined} from "@ant-design/icons"
import {Divider, Form, Modal, Select, Spin} from "antd"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {v4 as uuidv4} from "uuid"

interface NewAnnotationModalProps {
    open: boolean
    onCancel: () => void
    onSuccess?: () => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    divider: {
        margin: "1rem -1.5rem",
        width: "unset",
    },
}))

const NewAnnotationModal: React.FC<NewAnnotationModalProps> = ({open, onCancel, onSuccess}) => {
    const classes = useStyles()
    const appId = useAppId()
    const [form] = Form.useForm()
    const [fetching, setFetching] = useState(false)
    const [testsets, setTestsets] = useState<testset[]>([])
    const [variants, setVariants] = useState<Variant[]>([])
    const [submitLoading, setSubmitLoading] = useState(false)
    const [annotations, setAnnotations] = useState<
        {name: string; id: string; type: EvaluationType}[]
    >([
        {name: "Single Model Test", id: uuidv4(), type: EvaluationType.single_model_test},
        {name: "A/B Test", id: uuidv4(), type: EvaluationType.human_a_b_testing},
    ])

    useEffect(() => {
        setFetching(true)
        form.resetFields()
        Promise.all([fetchTestsets(appId), fetchVariants(appId)])
            .then(([testsets, variants]) => {
                setTestsets(testsets)
                setVariants(variants)
            })
            .catch(console.error)
            .finally(() => setFetching(false))
    }, [open, appId])

    const onSubmit = (values: CreateAnnotationData) => {
        setSubmitLoading(true)
        createAnnotation(appId, {
            variant_ids: values.variant_ids,
            testset_id: values.testset_id,
            evaluation_type: values.evaluation_type,
            status: EvaluationFlow.EVALUATION_INITIALIZED,
            inputs: [],
        })
            .then(onSuccess)
            .catch(console.error)
            .finally(() => setSubmitLoading(false))
    }

    return (
        <Modal
            title="New Annotation Configuration"
            onOk={form.submit}
            okButtonProps={{icon: <PlusOutlined />, loading: submitLoading}}
            okText="Create"
            open={open}
            onCancel={onCancel}
        >
            <Divider className={classes.divider} />
            <Spin spinning={fetching}>
                <Form
                    requiredMark={false}
                    form={form}
                    name="new-evaluation"
                    onFinish={onSubmit}
                    layout="vertical"
                >
                    <Form.Item
                        name="testset_id"
                        label="Test set"
                        rules={[{required: true, message: "This field is required"}]}
                    >
                        <Select placeholder="Select testset" data-cy="select-testset-group">
                            {testsets.map((testset) => (
                                <Select.Option
                                    key={testset._id}
                                    value={testset._id}
                                    data-cy="select-testset-option"
                                >
                                    {testset.name}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name="evaluation_type"
                        label="Annotation type"
                        rules={[{required: true, message: "This field is required"}]}
                    >
                        <Select placeholder="Select Annotation" data-cy="select-annotation-group">
                            {annotations.map((annotation) => (
                                <Select.Option
                                    key={annotation.id}
                                    value={annotation.type}
                                    data-cy="select-annotation-option"
                                >
                                    {annotation.name}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name="variant_ids"
                        label="Variants"
                        rules={[{required: true, message: "This field is required"}]}
                    >
                        <Select
                            mode="multiple"
                            placeholder="Select variants"
                            data-cy="select-variant-group"
                        >
                            {variants.map((variant) => (
                                <Select.Option
                                    key={variant.variantId}
                                    value={variant.variantId}
                                    data-cy="select-variant-option"
                                >
                                    {variant.variantName}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    {/* <Form.Item
                        name={"inputs"}
                        label="Questions"
                        data-cy="annotation_questions"
                    ></Form.Item> */}
                </Form>
            </Spin>
        </Modal>
    )
}

export default NewAnnotationModal
