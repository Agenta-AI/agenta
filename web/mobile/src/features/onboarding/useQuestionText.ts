import {useT, type CatalogKey} from "@agenta/i18n"
import questionsCatalog from "@agenta/i18n/catalogs/onboarding.questions"

import {onboardingQuestion} from "./onboardingQuestions"

type QuestionKey = CatalogKey<typeof questionsCatalog>

/** The catalog key of a question's text: `<id>Title`, `<id>Subtitle`, `<id>Dot` or `<id>Choice<n>`. */
export const questionKey = (id: string, part: string): QuestionKey =>
    `onboarding.questions.${id}${part}` as QuestionKey

/** The English the catalog holds for `<id><part>`; a question added to the registry before its text is not in it. */
const catalogHas = (id: string, part: string, text: string) =>
    questionsCatalog.en[`${id}${part}`] === text

/**
 * The shown text of the question registry. The registry's own English labels stay the stored
 * answers and the analytics values; only what the screen shows comes from the catalog. A question
 * or choice whose English the catalog does not hold shows the registry's English.
 */
export const useQuestionText = () => {
    const t = useT(questionsCatalog)
    const text = (id: string, part: string, registryText: string) =>
        catalogHas(id, part, registryText) ? t(questionKey(id, part)) : registryText
    return {
        title: (id: string) => text(id, "Title", onboardingQuestion(id)?.title ?? ""),
        subtitle: (id: string) => text(id, "Subtitle", onboardingQuestion(id)?.subtitle ?? ""),
        /** The progress dot's label; none for a step that is not a question. */
        dot: (step: string) => {
            const question = onboardingQuestion(step)
            return question ? text(step, "Dot", question.dot) : undefined
        },
        /** A choice's shown label, found by its stored label. */
        choice: (id: string, label: string) => {
            const index = onboardingQuestion(id)?.choices.findIndex((item) => item.label === label)
            return index === undefined || index < 0 ? label : text(id, `Choice${index}`, label)
        },
    }
}
