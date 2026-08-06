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
import {
    buildPostLoginPathResolved,
    waitForWorkspaceContext,
} from "@/oss/state/url/postLoginRedirect"

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
    agentExperience?: string,
): boolean => {
    if (!companySize || !userRole || !agentExperience) {
        return false
    }

    const isTargetCompanySize = ["11-50", "51-200", "201+"].includes(companySize)
    const isNotHobbyist = userRole !== "Hobbyist — personal projects"
    const isNotJustExploring = agentExperience !== "Not yet — just exploring"

    return isTargetCompanySize && isNotHobbyist && isNotJustExploring
}

// Exact PostHog choice strings -> $set boolean property names.
const INTENT_TO_PROPERTY: Record<string, string> = {
    "Build AI agents": "intent_agents",
    "Automate workflows for my team": "intent_automation",
    "Evaluate and test LLM apps or agents": "intent_evaluation",
    "Manage and version prompts": "intent_prompt_management",
    "Monitor and trace in production": "intent_observability",
}

const convertIntentsToBinaryProperties = (intents?: string | string[]): Record<string, boolean> => {
    const safeIntents = Array.isArray(intents) ? intents : intents ? [intents] : []

    return Object.fromEntries(
        Object.entries(INTENT_TO_PROPERTY).map(([label, property]) => [
            property,
            safeIntents.includes(label),
        ]),
    )
}

const QUESTIONS_PER_PAGE = 3

type AnySurveyQuestion = SurveyQuestion & {
    hasOpenChoice?: boolean
    shuffleOptions?: boolean
    originalQuestionIndex?: number
}

// Semantic role a survey question plays, independent of its position or id.
type QuestionKind = "companySize" | "role" | "experience" | "intent" | "referral" | "email"

interface QuestionMeta {
    question: AnySurveyQuestion
    index: number
    kind?: QuestionKind
}

// Known question ids from the "Signup 3 - Agents" PostHog survey. Primary
// resolution path; survives copy edits to the question text.
const QUESTION_KIND_BY_ID: Record<string, QuestionKind> = {
    "3b4ac88c-7530-46f1-b54a-c42bf6aca67a": "companySize",
    "d71aec24-7e9b-4d89-9cd7-c8f366693367": "role",
    "789e5248-429f-4ba7-9993-e93ac8ad56a1": "experience",
    "5f1e7a56-2ceb-41ea-8973-6bbe8050f206": "intent",
    "e15a61d7-15b2-4ddd-9efd-b2e154005675": "referral",
    "d6c2d8aa-d624-4736-a71b-25fe0b74d0e9": "email",
}

// Fallback when the survey is edited/recreated in PostHog and ids shift.
const QUESTION_KIND_KEYWORD_MATCHERS: {
    kind: QuestionKind
    matches: (question: AnySurveyQuestion) => boolean
}[] = [
    {kind: "companySize", matches: (q) => /size of your company/i.test(q.question)},
    {kind: "role", matches: (q) => /best describes you/i.test(q.question)},
    {
        kind: "experience",
        matches: (q) => /built ai agents|automations before/i.test(q.question),
    },
    {kind: "intent", matches: (q) => /want to do with agenta/i.test(q.question)},
    {kind: "referral", matches: (q) => /hear about us/i.test(q.question)},
    {
        kind: "email",
        matches: (q) => q.type === SurveyQuestionType.Open && /email/i.test(q.question),
    },
]

const resolveQuestionKind = (question: AnySurveyQuestion): QuestionKind | undefined =>
    (question.id ? QUESTION_KIND_BY_ID[question.id] : undefined) ??
    QUESTION_KIND_KEYWORD_MATCHERS.find(({matches}) => matches(question))?.kind

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
        return survey.questions.map((q: SurveyQuestion, index) => {
            const question = q as AnySurveyQuestion
            return {
                question,
                index,
                kind: resolveQuestionKind(question),
            }
        })
    }, [survey.questions])

    const visibleQuestions: QuestionMeta[] = useMemo(
        () => allQuestions.filter(({kind}) => kind !== "email"),
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
            // prefetched post-login route swaps in before the new render
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

                allQuestions.forEach(({question, index, kind}) => {
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
                    if (kind === "email") {
                        responses[key] = user.email
                        return
                    }

                    if (answer !== undefined) {
                        responses[key] = answer
                    }

                    switch (kind) {
                        case "companySize":
                            personProperties.company_size_v2 = Array.isArray(answer)
                                ? answer[0]
                                : answer
                            break
                        case "role":
                            personProperties.user_role_v2 = answer
                            break
                        case "experience":
                            personProperties.agent_experience_v2 = answer
                            break
                        case "intent":
                            Object.assign(
                                personProperties,
                                convertIntentsToBinaryProperties(answer),
                            )
                            break
                        case "referral":
                            personProperties.referral_source_v2 = answer
                            break
                    }
                })

                personProperties.is_icp_v2 = calculateICP(
                    personProperties.company_size_v2,
                    personProperties.user_role_v2,
                    personProperties.agent_experience_v2,
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
                const context = await waitForWorkspaceContext({requireProjectId: false})
                const nextPath = await buildPostLoginPathResolved(context)
                await router.push(nextPath)
            } catch (navError) {
                console.error("Failed to navigate to the post-login path:", navError)
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
        const {question, index, kind} = meta
        const fieldName = `question_${index}`
        const choices = questionChoices[index] || []
        const isMultiple = question.type === SurveyQuestionType.MultipleChoice
        const hasOpenChoice = question.hasOpenChoice || choices.includes("Other")

        const currentValue = formData?.[fieldName]
        const showOtherInput = isMultiple
            ? Array.isArray(currentValue) && currentValue.includes("Other")
            : currentValue === "Other"

        // Special rendering for the "Company Size" question
        if (kind === "companySize") {
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
