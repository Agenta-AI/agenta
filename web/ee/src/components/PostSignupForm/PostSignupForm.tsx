import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {Button, Checkbox, Form, Input, Radio, Rate, Space, Spin, Typography} from "antd"
import Image from "next/image"
import {useRouter} from "next/router"
import {MultipleSurveyQuestion, SurveyQuestion, SurveyQuestionType} from "posthog-js"

import ListOfOrgs from "@/oss/components/Sidebar/components/ListOfOrgs"
import useURL from "@/oss/hooks/useURL"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {useSurvey} from "@/oss/lib/helpers/analytics/hooks/useSurvey"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {buildPostLoginPath, waitForWorkspaceContext} from "@/oss/state/url/postLoginRedirect"

import {useStyles} from "./assets/styles"
import {OnboardingScreen} from "./OnboardingScreen"

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

const convertInterestsToBinaryProperties = (
    interests?: string | string[],
): Record<string, boolean> => {
    const safeInterests = Array.isArray(interests) ? interests : interests ? [interests] : []

    return {
        interest_evaluation: safeInterests.includes("Evaluating LLM Applications"),
        interest_no_code: safeInterests.includes("No-code LLM application building"),
        interest_prompt_management: safeInterests.includes("Prompt management and versioning"),
        interest_prompt_engineering: safeInterests.includes("Prompt engineering"),
        interest_observability: safeInterests.includes("Observability, tracing and monitoring"),
    }
}

const QUESTIONS_PER_PAGE = 3

type AnySurveyQuestion = SurveyQuestion & {
    hasOpenChoice?: boolean
    shuffleOptions?: boolean
    originalQuestionIndex?: number
}

interface QuestionMeta {
    question: AnySurveyQuestion
    index: number
    originalIndex: number
}

const PostSignupForm = () => {
    const [form] = Form.useForm()
    const router = useRouter()
    const posthog = usePostHogAg()
    const {user} = useProfileData()
    const classes = useStyles()
    const {orgs} = useOrgData()
    const formData = Form.useWatch([], form)
    const [currentStep, setCurrentStep] = useState(0)
    const [showOnboarding, setShowOnboarding] = useState(false)
    const {survey, loading, error} = useSurvey("Signup 2")
    const {baseAppURL} = useURL()
    const [autoRedirectAttempted, setAutoRedirectAttempted] = useState(false)

    // Safely handle redirect query as string | string[]
    const redirectParam = useMemo(() => {
        const r = router.query.redirect
        if (Array.isArray(r)) return r[0] || ""
        return (r as string) || ""
    }, [router.query.redirect])

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

    /**
     * Wrap all survey questions with their array index and a stable "originalIndex".
     * originalIndex uses question.originalQuestionIndex when available, else falls back to index.
     */
    const allQuestions: QuestionMeta[] = useMemo(() => {
        if (!survey?.questions) return []
        return survey.questions.map(
            (q: SurveyQuestion & {originalQuestionIndex?: number}, index) => {
                const originalIndex =
                    typeof q.originalQuestionIndex === "number" ? q.originalQuestionIndex : index

                return {
                    question: q as AnySurveyQuestion,
                    index,
                    originalIndex,
                }
            },
        )
    }, [survey?.questions])

    /**
     * Filter out questions that should not be shown (for example, email question).
     */
    const visibleQuestions: QuestionMeta[] = useMemo(() => {
        return allQuestions.filter(({question, originalIndex}) => {
            // Filter out the email question based on known original index or wording
            if (originalIndex === 5) return false
            if (
                question.type === SurveyQuestionType.Open &&
                question.question.toLowerCase().includes("email")
            ) {
                return false
            }
            return true
        })
    }, [allQuestions])

    const totalSteps = Math.ceil(visibleQuestions.length / QUESTIONS_PER_PAGE)

    const handleNextStep = useCallback(async () => {
        try {
            await form.validateFields()
            setCurrentStep((prev) => prev + 1)
        } catch {
            // Validation failed, do nothing
        }
    }, [form])

    const handleSubmitFormData = useCallback(
        async (values: any) => {
            try {
                // Get all values including unmounted fields from previous steps
                const allValues = {...form.getFieldsValue(true), ...values}

                const responses: Record<string, unknown> = {}
                const personProperties: Record<string, any> = {}

                allQuestions.forEach(({question, index, originalIndex}) => {
                    const key = `$survey_response_${question.id}`
                    const fieldName = `question_${index}`
                    let answer = allValues[fieldName]

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

                    // Special handling for email question if it was skipped in the form
                    if (
                        originalIndex === 5 ||
                        (question.type === SurveyQuestionType.Open &&
                            question.question.toLowerCase().includes("email"))
                    ) {
                        responses[key] = user?.email
                        return
                    }

                    if (answer !== undefined) {
                        responses[key] = answer
                    }

                    // Map to legacy person properties for ICP calculation
                    if (originalIndex === 0) {
                        personProperties.company_size_v1 = Array.isArray(answer)
                            ? answer[0]
                            : answer
                    } else if (originalIndex === 1) {
                        personProperties.user_role_v1 = answer
                    } else if (originalIndex === 2) {
                        personProperties.user_experience_v1 = answer
                    } else if (originalIndex === 3) {
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
                setShowOnboarding(true)
            }
        },
        [
            allQuestions,
            form,
            navigateToPostSignupDestination,
            posthog,
            survey?.id,
            survey?.name,
            user?.email,
        ],
    )

    // Memoize shuffled choices keyed by the stable question index
    const questionChoices = useMemo(() => {
        if (!allQuestions.length) return {}
        const choicesMap: Record<number, string[]> = {}

        allQuestions.forEach(({question, index}) => {
            // Choices only exist on multiple / single choice questions
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
    }, [allQuestions])

    const renderQuestion = (meta: QuestionMeta) => {
        const {question, index, originalIndex} = meta
        const fieldName = `question_${index}`
        const choices = questionChoices[index] || []
        const isMultiple = question.type === SurveyQuestionType.MultipleChoice
        const hasOpenChoice = question.hasOpenChoice || choices.includes("Other")

        const currentValue = formData?.[fieldName]
        const showOtherInput = isMultiple
            ? Array.isArray(currentValue) && currentValue.includes("Other")
            : currentValue === "Other"

        // Special rendering for the "Company Size" question
        if (originalIndex === 0) {
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

        if (!choices.length) {
            if (question.type === SurveyQuestionType.Open) {
                return (
                    <div key={question.id}>
                        <Form.Item
                            name={fieldName}
                            className={classes.formItem}
                            label={question.question}
                            rules={[{required: true, message: "Please enter a response"}]}
                        >
                            <Input.TextArea rows={3} placeholder="Type here" />
                        </Form.Item>
                    </div>
                )
            }

            if (question.type === SurveyQuestionType.Rating) {
                const ratingMax =
                    (question as {scaleMax?: number; scale_max?: number}).scaleMax ??
                    (question as {scaleMax?: number; scale_max?: number}).scale_max ??
                    5

                return (
                    <div key={question.id}>
                        <Form.Item
                            name={fieldName}
                            className={classes.formItem}
                            label={question.question}
                            rules={[{required: true, message: "Please provide a rating"}]}
                        >
                            <Rate count={ratingMax} />
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
                        rules={[{required: true, message: "Please provide a response"}]}
                    >
                        <Input placeholder="Type here" />
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

    // Calculate if current step is valid to enable the button
    const isCurrentStepValid = useMemo(() => {
        if (!formData) return false

        return currentQuestions.every(({index}) => {
            const fieldName = `question_${index}`
            const val = formData[fieldName]

            if (!val || (Array.isArray(val) && val.length === 0)) return false

            if (val === "Other" || (Array.isArray(val) && val.includes("Other"))) {
                if (!formData[`${fieldName}_other`]) return false
            }

            return true
        })
    }, [currentQuestions, formData])

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
                    overrideOrgId={orgs && orgs.length > 0 ? orgs[0]?.id : undefined}
                />
            </section>

            {showOnboarding ? (
                <OnboardingScreen />
            ) : (
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
                                        {currentStep + 1}/{totalSteps || 1}
                                    </Typography.Paragraph>
                                    <Typography.Title level={3}>
                                        {currentStep === 0
                                            ? "Tell us about yourself"
                                            : "Almost done"}
                                    </Typography.Title>
                                </div>

                                <div>{currentQuestions.map((meta) => renderQuestion(meta))}</div>
                            </div>

                            <Button
                                size="large"
                                type="primary"
                                onClick={
                                    currentStep < totalSteps - 1 ? handleNextStep : form.submit
                                }
                                className="w-full min-h-[32px] mt-2"
                                iconPosition="end"
                                icon={<ArrowRight className="mt-[3px]" />}
                                disabled={!isCurrentStepValid}
                            >
                                {currentStep < totalSteps - 1 ? "Continue" : "Submit"}
                            </Button>
                        </Form>
                    )}
                </Spin>
            )}
        </>
    )
}

export default PostSignupForm
