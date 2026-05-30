import {useCallback, useMemo, useState} from "react"

import type {User} from "@agenta/shared/types"
import {ArrowRight} from "@phosphor-icons/react"
import {Button, Checkbox, Form, Input, Radio, Rate, Space, Typography} from "antd"
import {useRouter} from "next/router"
import {
    type MultipleSurveyQuestion,
    type PostHog,
    type Survey,
    type SurveyQuestion,
    SurveyQuestionType,
} from "posthog-js"
import {flushSync} from "react-dom"

import type {Org} from "@/oss/lib/Types"

import PostSignupHeader from "./PostSignupHeader"
import PostSignupSubmitting from "./PostSignupSubmitting"

const mainContainerClass = "w-[400px] mx-auto h-[82vh] flex flex-col justify-between"
const containerClass =
    "p-6 grid gap-8 rounded-lg shadow-[0px_9px_28px_8px_#0000000D,0px_3px_6px_-4px_#0000001F,0px_6px_16px_0px_#00000014] border border-colorBorder"
const formItemClass = "gap-2 [&>.ant-form-item-row>.ant-form-item-label]:font-medium"

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

const isEmailQuestion = (question: AnySurveyQuestion, originalIndex: number): boolean => {
    if (originalIndex === 5) return true
    return (
        question.type === SurveyQuestionType.Open &&
        question.question.toLowerCase().includes("email")
    )
}

interface PostSignupFormProps {
    survey: Survey
    user: User
    orgs: Org[]
    posthog: PostHog
}

/**
 * Pure consumer of survey + user + orgs. Mounted only by PostSignupRoute,
 * which gates on all dependencies being present. No internal data fetching,
 * no error handling, no timeouts — just renders the form and submits results
 * back to PostHog.
 */
const PostSignupForm = ({survey, user, orgs, posthog}: PostSignupFormProps) => {
    const [form] = Form.useForm()
    const router = useRouter()
    const formData = Form.useWatch([], form)
    const [currentStep, setCurrentStep] = useState(0)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const allQuestions: QuestionMeta[] = useMemo(() => {
        if (!survey.questions) return []
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
    }, [survey.questions])

    const visibleQuestions: QuestionMeta[] = useMemo(
        () =>
            allQuestions.filter(
                ({question, originalIndex}) => !isEmailQuestion(question, originalIndex),
            ),
        [allQuestions],
    )

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
            // Force the submitting view to commit synchronously, then yield
            // one animation frame so the browser actually paints it before
            // we trigger navigation. Without flushSync + rAF, React 18
            // batches this state update with the rest of this task and the
            // prefetched /get-started route swaps in before the new render
            // ever reaches the screen — the user just sees the half-torn-
            // down form right up until the new page replaces it.
            flushSync(() => {
                setIsSubmitting(true)
            })
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

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

                    // The email question is filtered from the rendered form; we
                    // backfill it from the user's profile on submit so PostHog
                    // still receives a response for that question id.
                    if (isEmailQuestion(question, originalIndex)) {
                        responses[key] = user.email
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

                personProperties.is_icp_v1 = calculateICP(
                    personProperties.company_size_v1,
                    personProperties.user_role_v1,
                    personProperties.user_experience_v1,
                )

                posthog.capture("survey sent", {
                    $survey_id: survey.id,
                    $survey_name: survey.name,
                    ...responses,
                    $set: personProperties,
                })
            } catch (error) {
                console.error("Error submitting survey:", error)
            }

            try {
                // Awaited so a rejected navigation can't leave the user stuck on
                // the "Setting up your workspace" view forever. On failure we
                // drop back to the form so they can try again.
                await router.push("/get-started")
            } catch (navError) {
                console.error("Failed to navigate to /get-started:", navError)
                setIsSubmitting(false)
            }
        },
        [allQuestions, form, posthog, router, survey.id, survey.name, user.email],
    )

    // Memoize shuffled choices keyed by the stable question index
    const questionChoices = useMemo(() => {
        if (!allQuestions.length) return {}
        const choicesMap: Record<number, string[]> = {}

        allQuestions.forEach(({question, index}) => {
            const q = question as MultipleSurveyQuestion & {shuffleOptions?: boolean}
            if (!q.choices) {
                choicesMap[index] = []
                return
            }

            const choices = Array.isArray(q.choices) ? q.choices : []
            const otherIndex = choices.indexOf("Other")
            const hasOther = otherIndex !== -1
            const choicesToShuffle = hasOther
                ? choices.filter((choice) => choice !== "Other")
                : choices

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
                        className={formItemClass}
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
                            className={formItemClass}
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
                            className={formItemClass}
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
                        className={formItemClass}
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
                    className={formItemClass}
                    label={question.question}
                    rules={[{required: true, message: "Please select an option"}]}
                >
                    {isMultiple ? (
                        <Checkbox.Group>
                            <Space orientation="vertical">
                                {choices.map((choice: string) => (
                                    <Checkbox key={choice} value={choice}>
                                        {choice}
                                    </Checkbox>
                                ))}
                            </Space>
                        </Checkbox.Group>
                    ) : (
                        <Radio.Group>
                            <Space orientation="vertical" className="w-full">
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

    const isLastStep = currentStep >= totalSteps - 1

    // Once we start submitting, replace the form with a clear, full-page
    // "setting up" view. The form is about to be unmounted by router.push
    // anyway — rendering an unambiguous transition state is better than
    // showing the form as a half-disabled, half-overlaid intermediate state
    // that can briefly blank out during Next.js's chunk fetch.
    if (isSubmitting) {
        return <PostSignupSubmitting orgs={orgs} />
    }

    return (
        <>
            <PostSignupHeader orgs={orgs} />

            <Form
                layout="vertical"
                form={form}
                onFinish={handleSubmitFormData}
                className={mainContainerClass}
            >
                <div className={containerClass}>
                    <div className="space-y-1">
                        <Typography.Paragraph>
                            {currentStep + 1}/{totalSteps || 1}
                        </Typography.Paragraph>
                        <Typography.Title level={3}>
                            {currentStep === 0 ? "Tell us about yourself" : "Almost done"}
                        </Typography.Title>
                    </div>

                    <div>{currentQuestions.map((meta) => renderQuestion(meta))}</div>
                </div>

                <Button
                    size="large"
                    type="primary"
                    onClick={isLastStep ? form.submit : handleNextStep}
                    className="w-full min-h-[32px] mt-2"
                    iconPlacement="end"
                    icon={<ArrowRight className="mt-[3px]" />}
                    disabled={!isCurrentStepValid}
                >
                    {isLastStep ? "Submit" : "Continue"}
                </Button>
            </Form>
        </>
    )
}

export default PostSignupForm
