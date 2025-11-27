import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {Button, Checkbox, Form, FormProps, Input, Radio, Space, Spin, Typography} from "antd"
import Image from "next/image"
import {useRouter} from "next/router"
import {MultipleSurveyQuestion, SurveyQuestion} from "posthog-js"

import ListOfOrgs from "@/oss/components/Sidebar/components/ListOfOrgs"
import useURL from "@/oss/hooks/useURL"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {useSurvey} from "@/oss/lib/helpers/analytics/hooks/useSurvey"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {buildPostLoginPath, waitForWorkspaceContext} from "@/oss/state/url/postLoginRedirect"

import {useStyles} from "./assets/styles"

// Fisher-Yates shuffle algorithm
const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
}

const calculateICP = (
    companySize?: string,
    userRole?: string,
    userExperience?: string,
): boolean => {
    if (!companySize || !userRole || !userExperience) {
        return false
    }

    const isTargetCompanySize = ["11-50", "51-200", "201+"].includes(companySize)
    const isNotHobbyist = userRole !== "Hobbyist"
    const isNotJustExploring = userExperience !== "Just exploring"

    return isTargetCompanySize && isNotHobbyist && isNotJustExploring
}

const convertInterestsToBinaryProperties = (interests?: string[]): Record<string, boolean> => {
    // Fail-safe: if interests is undefined or not an array, default to empty array
    const safeInterests = Array.isArray(interests) ? interests : []

    return {
        interest_evaluation: safeInterests.includes("Evaluating LLM Applications"),
        interest_no_code: safeInterests.includes("No-code LLM application building"),
        interest_prompt_management: safeInterests.includes("Prompt management and versioning"),
        interest_prompt_engineering: safeInterests.includes("Prompt engineering"),
        interest_observability: safeInterests.includes("Observability, tracing and monitoring"),
    }
}

const QUESTIONS_PER_PAGE = 3

const PostSignupForm = () => {
    const [form] = Form.useForm()
    const router = useRouter()
    const posthog = usePostHogAg()
    const {user} = useProfileData()
    const classes = useStyles()
    const {orgs} = useOrgData()
    const formData = Form.useWatch([], form)
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

    // Filter out questions that shouldn't be shown (e.g. email if handled automatically)
    // For now, we'll filter out the specific email question if it matches the one in the JSON
    // or if it's an open question asking for email and we already have it.
    const visibleQuestions = useMemo(() => {
        if (!survey?.questions) return []
        return survey.questions.filter((q: any) => {
            // Filter out the email question if it's the specific one we know about
            // or if it's an open question with "email" in the text
            if (q.originalQuestionIndex === 5) return false
            if (q.type === "open" && q.question.toLowerCase().includes("email")) return false
            return true
        })
    }, [survey?.questions])

    const totalSteps = Math.ceil(visibleQuestions.length / QUESTIONS_PER_PAGE)

    const handleNextStep = useCallback(async () => {
        try {
            await form.validateFields()
            setCurrentStep((prev) => prev + 1)
        } catch (e) {
            // Validation failed
        }
    }, [form])

    const handleSubmitFormData = useCallback(
        async (values: any) => {
            try {
                // Get all values including unmounted fields from previous steps
                const allValues = {...form.getFieldsValue(true), ...values}

                const responses: Record<string, unknown> = {}
                const personProperties: Record<string, any> = {}

                // Process all questions from the survey (including hidden ones if necessary, but here we iterate visible)
                // We need to map back to the original questions to handle the responses correctly
                survey?.questions.forEach((question: any, index: number) => {
                    const key = `$survey_response_${question.id}`
                    const fieldName = `question_${index}`
                    let answer = allValues[fieldName] // Use allValues here

                    // Handle "Other" input
                    if (
                        Array.isArray(answer) &&
                        answer.includes("Other") &&
                        allValues[`${fieldName}_other`]
                    ) {
                        answer = answer.map((a: string) =>
                            a === "Other" ? allValues[`${fieldName}_other`] : a,
                        )
                    } else if (answer === "Other" && allValues[`${fieldName}_other`]) {
                        answer = allValues[`${fieldName}_other`]
                    }

                    // Special handling for email question if it was skipped in form
                    if (
                        question.originalQuestionIndex === 5 ||
                        (question.type === "open" &&
                            question.question.toLowerCase().includes("email"))
                    ) {
                        responses[key] = user?.email
                        return
                    }

                    if (answer !== undefined) {
                        responses[key] = answer
                    }

                    // Map to legacy person properties for ICP calculation
                    // We use originalQuestionIndex if available, otherwise we might miss some
                    if (question.originalQuestionIndex === 0) {
                        personProperties.company_size_v1 = Array.isArray(answer)
                            ? answer[0]
                            : answer
                    } else if (question.originalQuestionIndex === 1) {
                        personProperties.user_role_v1 = answer
                    } else if (question.originalQuestionIndex === 2) {
                        personProperties.user_experience_v1 = answer
                    } else if (question.originalQuestionIndex === 3) {
                        Object.assign(personProperties, convertInterestsToBinaryProperties(answer))
                    }
                })

                const isICP = calculateICP(
                    personProperties.company_size_v1,
                    personProperties.user_role_v1,
                    personProperties.user_experience_v1,
                )
                personProperties.is_icp_v1 = isICP

                await posthog?.capture?.("survey sent", {
                    $survey_id: survey?.id,
                    $survey_name: survey?.name,
                    ...responses,
                    $set: personProperties,
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
            survey?.id,
            survey?.name,
            survey?.questions,
            user?.email,
            navigateToPostSignupDestination,
        ],
    )

    // Memoize shuffled choices
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
            const otherIndex = choices.indexOf("Other")
            const hasOther = otherIndex !== -1
            let choicesToShuffle = choices
            if (hasOther) {
                choicesToShuffle = choices.filter((choice) => choice !== "Other")
            }
            const shuffled = q.shuffleOptions ? shuffleArray(choicesToShuffle) : choicesToShuffle
            choicesMap[index] = hasOther ? [...shuffled, "Other"] : shuffled
        })
        return choicesMap
    }, [survey?.questions])

    const renderQuestion = (question: any, index: number) => {
        const fieldName = `question_${index}`
        const choices = questionChoices[index] || []
        const isMultiple = question.type === "multiple_choice"
        const hasOpenChoice = question.hasOpenChoice || choices.includes("Other")

        // Check if "Other" is selected to show input
        const currentValue = formData?.[fieldName]
        const showOtherInput = isMultiple
            ? Array.isArray(currentValue) && currentValue.includes("Other")
            : currentValue === "Other"

        // Special rendering for the first question (Company Size)
        if (index === 0) {
            return (
                <div key={question.id}>
                    <Form.Item
                        name={fieldName}
                        className={classes.formItem}
                        label={question.question}
                        rules={[{required: true, message: "Please select an option"}]}
                    >
                        <Radio.Group
                            optionType="button"
                            className="*:w-full text-center flex justify-between *:whitespace-nowrap"
                        >
                            {choices.map((choice: string) => (
                                <Radio key={choice} value={choice}>
                                    {choice}
                                </Radio>
                            ))}
                        </Radio.Group>
                    </Form.Item>
                </div>
            )
        }

        return (
            <div key={question.id}>
                <Form.Item
                    name={fieldName}
                    className={classes.formItem}
                    label={question.question}
                    rules={[{required: true, message: "Please select an option"}]}
                >
                    {isMultiple ? (
                        <Checkbox.Group>
                            <Space direction="vertical">
                                {choices.map((choice: string) => (
                                    <Checkbox key={choice} value={choice}>
                                        {choice}
                                    </Checkbox>
                                ))}
                            </Space>
                        </Checkbox.Group>
                    ) : (
                        <Radio.Group>
                            <Space direction="vertical" className="w-full">
                                {choices.map((choice: string) => (
                                    <Radio key={choice} value={choice}>
                                        {choice}
                                    </Radio>
                                ))}
                            </Space>
                        </Radio.Group>
                    )}
                </Form.Item>

                {hasOpenChoice && showOtherInput && (
                    <Form.Item
                        name={`${fieldName}_other`}
                        className="-mt-3"
                        rules={[{required: true, message: "Please specify"}]}
                    >
                        <Input placeholder="Type here" />
                    </Form.Item>
                )}
            </div>
        )
    }

    const currentQuestions = useMemo(() => {
        const start = currentStep * QUESTIONS_PER_PAGE
        return visibleQuestions.slice(start, start + QUESTIONS_PER_PAGE)
    }, [currentStep, visibleQuestions])

    // Calculate if current step is valid to enable button
    const isCurrentStepValid = useMemo(() => {
        if (!formData) return false
        return currentQuestions.every((q: any) => {
            const index = survey?.questions.indexOf(q)
            const fieldName = `question_${index}`
            const val = formData[fieldName]

            if (!val || (Array.isArray(val) && val.length === 0)) return false

            // Check other input if selected
            if (val === "Other" || (Array.isArray(val) && val.includes("Other"))) {
                if (!formData[`${fieldName}_other`]) return false
            }

            return true
        })
    }, [currentQuestions, formData, survey?.questions])

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
                {showSurveyForm && (
                    <Form
                        layout="vertical"
                        form={form}
                        onFinish={handleSubmitFormData}
                        className={classes.mainContainer}
                    >
                        <div className={classes.container}>
                            <div className="space-y-1">
                                <Typography.Paragraph>
                                    {currentStep + 1}/{totalSteps}
                                </Typography.Paragraph>
                                <Typography.Title level={3}>
                                    {currentStep === 0 ? "Tell us about yourself" : "Almost done"}
                                </Typography.Title>
                            </div>

                            <div>
                                {currentQuestions.map((q: any) =>
                                    renderQuestion(q, survey?.questions.indexOf(q) ?? 0),
                                )}
                            </div>
                        </div>

                        <Button
                            size="large"
                            type="primary"
                            onClick={currentStep < totalSteps - 1 ? handleNextStep : form.submit}
                            className="w-full"
                            iconPosition="end"
                            icon={<ArrowRight className="mt-[3px]" />}
                            disabled={!isCurrentStepValid}
                        >
                            {currentStep < totalSteps - 1 ? "Continue" : "Submit"}
                        </Button>
                    </Form>
                )}
            </Spin>
        </>
    )
}

export default PostSignupForm
