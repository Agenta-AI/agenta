import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowRight, CaretDown, SignOut} from "@phosphor-icons/react"
import {
    Button,
    Checkbox,
    Dropdown,
    Form,
    FormProps,
    Input,
    Radio,
    Space,
    Spin,
    Typography,
} from "antd"
import Image from "next/image"
import {useRouter} from "next/router"
import {MultipleSurveyQuestion} from "posthog-js"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import Avatar from "@/oss/components/Avatar/Avatar"
import {useOrgData} from "@/oss/contexts/org.context"
import {useProfileData} from "@/oss/contexts/profile.context"
import {useSession} from "@/oss/hooks/useSession"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {useSurvey} from "@/oss/lib/helpers/analytics/hooks/useSurvey"
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

import {useStyles} from "./assets/styles"
import {FormDataType} from "./assets/types"

const PostSignupForm = () => {
    const [form] = Form.useForm()
    const router = useRouter()
    const {logout} = useSession()
    const posthog = usePostHogAg()
    const {user} = useProfileData()
    const classes = useStyles()
    const {selectedOrg, changeSelectedOrg} = useOrgData()
    const selectedHearAboutUsOption = Form.useWatch("hearAboutUs", form)
    const formData = Form.useWatch([], form)
    const [stepOneFormData, setStepOneFormData] = useState<any>({} as any)
    const [currentStep, setCurrentStep] = useState(0)
    const {survey, loading} = useSurvey("Signup 2")

    useEffect(() => {
        let timer: number | undefined

        timer = window.setTimeout(() => {
            if (!getEnv("NEXT_PUBLIC_POSTHOG_API_KEY") || !survey || !survey?.id) {
                router.push("/apps")
            }
        }, 2000)

        return () => {
            clearTimeout(timer)
        }
    }, [survey])

    const handleStepOneFormData: FormProps<FormDataType>["onFinish"] = useCallback(
        async (values: any) => {
            setStepOneFormData(values)
            setCurrentStep(1)
        },
        [],
    )

    const handleSubmitFormData: FormProps<FormDataType>["onFinish"] = useCallback(
        async (values: any) => {
            const hearAboutUs =
                values.hearAboutUs == "Other" ? values.hearAboutUsInputOption : values.hearAboutUs

            try {
                const responses = survey?.questions?.reduce(
                    (acc: Record<string, unknown>, question, index) => {
                        const key = `$survey_response_${question.id}`
                        switch (index) {
                            case 0:
                                acc[key] = [stepOneFormData.companySize]
                                break
                            case 1:
                                acc[key] = stepOneFormData.userRole
                                break
                            case 2:
                                acc[key] = stepOneFormData.userExperience
                                break
                            case 3:
                                acc[key] = values.userInterests
                                break
                            case 4:
                                acc[key] = [hearAboutUs]
                                break
                            case 5:
                                // the user's email is captured as a survey
                                // response only; posthog.identify is called
                                // elsewhere so we don't send a separate
                                // `user_email` property
                                acc[key] = user?.email
                                break
                        }
                        return acc
                    },
                    {},
                )

                await posthog?.capture?.("survey sent", {
                    $survey_id: survey?.id,
                    $survey_name: survey?.name,
                    ...responses,
                })

                form.resetFields()
            } catch (error) {
                console.error("Error submitting form:", error)
            } finally {
                router.push("/apps")
            }
        },
        [
            form,
            posthog,
            stepOneFormData.companySize,
            stepOneFormData.userExperience,
            stepOneFormData.userRole,
            survey?.id,
            survey?.name,
            user?.email,
        ],
    )

    const steps = useMemo(() => {
        return [
            {
                content: (
                    <Form
                        layout="vertical"
                        form={form}
                        onFinish={handleStepOneFormData}
                        className={classes.mainContainer}
                    >
                        <div className={classes.container}>
                            <div className="space-y-1">
                                <Typography.Paragraph>1/2</Typography.Paragraph>
                                <Typography.Title level={3}>
                                    Tell us about yourself
                                </Typography.Title>
                            </div>

                            <div>
                                <Form.Item
                                    name="companySize"
                                    className={classes.formItem}
                                    label={survey?.questions[0].question}
                                >
                                    <Radio.Group
                                        optionType="button"
                                        className="*:w-full text-center flex justify-between *:whitespace-nowrap"
                                    >
                                        {(
                                            survey?.questions[0] as MultipleSurveyQuestion
                                        )?.choices?.map((choice: string) => (
                                            <Radio key={choice} value={choice}>
                                                {choice}
                                            </Radio>
                                        ))}
                                    </Radio.Group>
                                </Form.Item>

                                <Form.Item
                                    name="userExperience"
                                    className={classes.formItem}
                                    label={survey?.questions[2].question}
                                >
                                    <Radio.Group>
                                        <Space direction="vertical">
                                            {(
                                                survey?.questions[2] as MultipleSurveyQuestion
                                            )?.choices?.map((choice: string) => (
                                                <Radio key={choice} value={choice}>
                                                    {choice}
                                                </Radio>
                                            ))}
                                        </Space>
                                    </Radio.Group>
                                </Form.Item>

                                <Form.Item
                                    name="userRole"
                                    className={classes.formItem}
                                    label={survey?.questions[1].question}
                                >
                                    <Radio.Group>
                                        <Space direction="vertical">
                                            {(
                                                survey?.questions[1] as MultipleSurveyQuestion
                                            )?.choices.map((choice: string) => (
                                                <Radio key={choice} value={choice}>
                                                    {choice}
                                                </Radio>
                                            ))}
                                        </Space>
                                    </Radio.Group>
                                </Form.Item>
                            </div>
                        </div>

                        <Button
                            size="large"
                            type="primary"
                            htmlType="submit"
                            className="w-full"
                            iconPosition="end"
                            icon={<ArrowRight className="mt-[3px]" />}
                            disabled={
                                !formData?.companySize ||
                                !formData?.userRole ||
                                !formData?.userExperience
                            }
                        >
                            Continue
                        </Button>
                    </Form>
                ),
            },
            {
                content: (
                    <Form
                        form={form}
                        layout="vertical"
                        onFinish={handleSubmitFormData}
                        className={classes.mainContainer}
                    >
                        <div className={classes.container}>
                            <div className="space-y-1">
                                <Typography.Paragraph>2/2</Typography.Paragraph>
                                <Typography.Title level={3}>What brings you here?</Typography.Title>
                            </div>

                            <div>
                                <Form.Item
                                    name="userInterests"
                                    className={classes.formItem}
                                    label={survey?.questions[3].question}
                                >
                                    <Checkbox.Group>
                                        <Space direction="vertical">
                                            {(
                                                survey?.questions[3] as MultipleSurveyQuestion
                                            )?.choices?.map((role: string) => (
                                                <Checkbox key={role} value={role}>
                                                    {role}
                                                </Checkbox>
                                            ))}
                                        </Space>
                                    </Checkbox.Group>
                                </Form.Item>

                                <Form.Item
                                    className={classes.formItem}
                                    name="hearAboutUs"
                                    label={survey?.questions[4].question}
                                >
                                    <Radio.Group>
                                        <Space direction="vertical">
                                            {(
                                                survey?.questions[4] as MultipleSurveyQuestion
                                            )?.choices?.map((choice: string) => (
                                                <Radio key={choice} value={choice}>
                                                    {choice}
                                                </Radio>
                                            ))}
                                        </Space>
                                    </Radio.Group>
                                </Form.Item>

                                {selectedHearAboutUsOption == "Other" && (
                                    <Form.Item name="hearAboutUsInputOption" className="-mt-3">
                                        <Input placeholder="Type here" />
                                    </Form.Item>
                                )}
                            </div>
                        </div>

                        <Button
                            size="large"
                            type="primary"
                            htmlType="submit"
                            className="w-full"
                            iconPosition="end"
                            icon={<ArrowRight className="mt-[3px]" />}
                            disabled={!formData?.userInterests?.length || !formData?.hearAboutUs}
                        >
                            Continue
                        </Button>
                    </Form>
                ),
            },
        ]
    }, [
        classes.container,
        classes.formItem,
        classes.mainContainer,
        form,
        formData?.companySize,
        formData?.hearAboutUs,
        formData?.userExperience,
        formData?.userInterests?.length,
        formData?.userRole,
        handleStepOneFormData,
        handleSubmitFormData,
        selectedHearAboutUsOption,
        survey?.questions,
    ])

    return (
        <>
            <section className="w-[90%] flex items-center justify-between mx-auto mt-12 mb-5">
                <Image
                    src="/assets/light-complete-transparent-CROPPED.png"
                    alt="agenta-ai"
                    width={114}
                    height={40}
                />

                <Dropdown
                    trigger={["hover"]}
                    menu={{
                        items: [
                            {
                                key: "logout",
                                label: (
                                    <div className="flex items-center gap-2">
                                        <SignOut size={16} />
                                        <Typography.Text>Logout</Typography.Text>
                                    </div>
                                ),
                                onClick: () => {
                                    AlertPopup({
                                        title: "Logout",
                                        message: "Are you sure you want to logout?",
                                        onOk: logout,
                                    })
                                },
                            },
                        ],
                        selectedKeys: [selectedOrg?.id as string],
                        onClick: ({key}) => {
                            if (["logout"].includes(key)) return
                            changeSelectedOrg(key)
                        },
                    }}
                >
                    <Button
                        className="w-[186px] !p-1 !h-10 rounded"
                        icon={<CaretDown size={14} />}
                        iconPosition="end"
                    >
                        <div className="flex items-center w-[85%]">
                            <Avatar
                                className="text-lg !rounded"
                                name={selectedOrg?.name as string}
                            />

                            <Typography.Paragraph className="ml-2 w-[70%] truncate !mb-0">
                                {selectedOrg?.name}
                            </Typography.Paragraph>
                        </div>
                    </Button>
                </Dropdown>
            </section>

            <Spin spinning={loading && !survey?.id}>{steps[currentStep]?.content}</Spin>
        </>
    )
}

export default PostSignupForm
