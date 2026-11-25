import type {RegistrationSurvey} from "../settings/licenseApi"

import {answerLabels, onboardingQuestion, type OnboardingAnswers} from "./onboardingQuestions"

/** Which registration answer each survey question fills. */
const SURVEY_FIELDS: Record<string, keyof RegistrationSurvey> = {
    persona: "role",
    size: "team_size",
    source: "heard_from",
}

/** The choice an answer picked: its label, so a typed "Other: ..." line is never sent. */
const choiceLabel = (questionId: string, answer: string) =>
    onboardingQuestion(questionId)?.choices.find(
        (choice) => answer === choice.label || answer.startsWith(`${choice.label}: `),
    )?.label

/** The setup answers a registration carries: chosen option labels only. */
export const registrationSurvey = (answers: OnboardingAnswers): RegistrationSurvey =>
    Object.fromEntries(
        Object.entries(SURVEY_FIELDS).flatMap(([questionId, field]) => {
            const label = answerLabels(answers[questionId])
                .map((answer) => choiceLabel(questionId, answer))
                .find((found) => found !== undefined)
            return label ? [[field, label]] : []
        }),
    )
