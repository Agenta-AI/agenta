import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {Button, Checkbox, Form, FormProps, Input, Radio, Space, Spin, Typography} from "antd"
import Image from "next/image"
import {useRouter} from "next/router"
import {MultipleSurveyQuestion} from "posthog-js"

import ListOfOrgs from "@/oss/components/Sidebar/components/ListOfOrgs"
import useURL from "@/oss/hooks/useURL"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {useSurvey} from "@/oss/lib/helpers/analytics/hooks/useSurvey"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {buildPostLoginPath, waitForWorkspaceContext} from "@/oss/state/url/postLoginRedirect"

import {useStyles} from "./assets/styles"
import {FormDataType} from "./assets/types"

// Fisher-Yates shuffle algorithm
const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
}

const PostSignupForm = () => {
    const [form] = Form.useForm()
    const router = useRouter()
    const posthog = usePostHogAg()
    const {user} = useProfileData()
    const classes = useStyles()
    const {orgs} = useOrgData()
    const selectedHearAboutUsOption = Form.useWatch("hearAboutUs", form)
    const selectedUserInterests = Form.useWatch("userInterests", form)
    const formData = Form.useWatch([], form)
    const [stepOneFormData, setStepOneFormData] = useState<any>({} as any)
    const [currentStep, setCurrentStep] = useState(0)
    const {survey, loading, error} = useSurvey("Signup 2")
    const {baseAppURL} = useURL()
    const [autoRedirectAttempted, setAutoRedirectAttempted] = useState(false)
    const redirectParam = useMemo(
        () => (router.query.redirect as string) || "",
        [router.query.redirect],
    )
    const redirect = useCallback(
        async (target: string | null | undefined) => {
            if (!target) return false

            try {
                const normalizedTarget = target.split("?")[0]
                const latestPath = router.asPath.split("?")[0]

                if (normalizedTarget === latestPath) return false

                await router.replace(target)
                return true
            } catch (error) {
                console.error("post-signup redirect failed", error)
                return false
            }
        },
        [router],
    )

    const navigateToPostSignupDestination = useCallback(async () => {
        if (await redirect(redirectParam)) return
        if (await redirect(baseAppURL)) return

        try {
            const context = await waitForWorkspaceContext({
                timeoutMs: 1500,
                requireProjectId: false,
                requireOrgData: true,
            })
            const fallbackPath = buildPostLoginPath(context)

            if (await redirect(fallbackPath)) return
        } catch (error) {
            console.error("post-signup fallback redirect failed", error)
        }

        await redirect("/w")
    }, [baseAppURL, redirect, redirectParam])

    useEffect(() => {
        if (!error || autoRedirectAttempted) return

        setAutoRedirectAttempted(true)
        void navigateToPostSignupDestination()
    }, [autoRedirectAttempted, error, navigateToPostSignupDestination])

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

            // Handle "Other" option for userInterests (checkbox group - array)
            const userInterests = Array.isArray(values.userInterests)
                ? values.userInterests.map((interest: string) =>
                      interest === "Other" ? values.userInterestsInputOption : interest,
                  )
                : values.userInterests

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
                                acc[key] = userInterests
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
                await navigateToPostSignupDestination()
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
            navigateToPostSignupDestination,
        ],
    )

    // Memoize shuffled choices for each question to avoid re-shuffling on every render
    const questionChoices = useMemo(() => {
        if (!survey?.questions) return {}
        const choicesMap: Record<number, string[]> = {}
        survey.questions.forEach((question, index) => {
            const q = question as MultipleSurveyQuestion & {shuffleOptions?: boolean}
            if (!q.choices) {
                choicesMap[index] = []
                return
            }
            const choices = Array.isArray(q.choices) ? q.choices : []

            // Separate "Other" from other choices to always place it last
            const otherIndex = choices.indexOf("Other")
            const hasOther = otherIndex !== -1

            let choicesToShuffle = choices
            if (hasOther) {
                // Remove "Other" temporarily
                choicesToShuffle = choices.filter((choice) => choice !== "Other")
            }

            // Shuffle if shuffleOptions is enabled
            const shuffled = q.shuffleOptions ? shuffleArray(choicesToShuffle) : choicesToShuffle

            // Add "Other" back at the end if it existed
            choicesMap[index] = hasOther ? [...shuffled, "Other"] : shuffled
        })
        return choicesMap
    }, [survey?.questions])

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
                                        {(questionChoices[0] || []).map((choice: string) => (
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
                                            {(questionChoices[2] || []).map((choice: string) => (
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
                                            {(questionChoices[1] || []).map((choice: string) => (
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
                                            {(questionChoices[3] || []).map((role: string) => (
                                                <Checkbox key={role} value={role}>
                                                    {role}
                                                </Checkbox>
                                            ))}
                                        </Space>
                                    </Checkbox.Group>
                                </Form.Item>

                                {selectedUserInterests?.includes("Other") && (
                                    <Form.Item name="userInterestsInputOption" className="-mt-3">
                                        <Input placeholder="Type here" />
                                    </Form.Item>
                                )}

                                <Form.Item
                                    className={classes.formItem}
                                    name="hearAboutUs"
                                    label={survey?.questions[4].question}
                                >
                                    <Radio.Group>
                                        <Space direction="vertical">
                                            {(questionChoices[4] || []).map((choice: string) => (
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
                            disabled={
                                !formData?.userInterests?.length ||
                                !formData?.hearAboutUs ||
                                (selectedUserInterests?.includes("Other") &&
                                    !formData?.userInterestsInputOption)
                            }
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
        formData?.userInterestsInputOption,
        formData?.userRole,
        handleStepOneFormData,
        handleSubmitFormData,
        questionChoices,
        selectedHearAboutUsOption,
        selectedUserInterests,
        survey?.questions,
    ])

    const showSurveyForm = Boolean(survey?.questions?.length)
    const isSurveyLoading = loading && !error

    return (
        <>
            <section className="w-[90%] flex items-center justify-between mx-auto mt-12 mb-5">
                <Image
                    src="/assets/Agenta-logo-full-light.png"
                    alt="agenta-ai"
                    width={114}
                    height={40}
                />

                <ListOfOrgs
                    collapsed={false}
                    interactive={true}
                    orgSelectionEnabled={false}
                    buttonProps={{className: "w-[186px] !p-1 !h-10 rounded"}}
                    overrideOrgId={orgs?.[0]?.id}
                />
            </section>

            <Spin spinning={isSurveyLoading}>
                {showSurveyForm ? steps[currentStep]?.content : null}
            </Spin>
        </>
    )
}

export default PostSignupForm
