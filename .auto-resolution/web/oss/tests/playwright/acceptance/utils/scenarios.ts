type StepBody<T> = () => T | Promise<T>

type StepCapableTest = {
    step: <T>(title: string, body: StepBody<T>) => Promise<T>
}

type StepKeyword = "Given" | "When" | "Then" | "And" | "But"

const runStep = <T>(
    test: StepCapableTest,
    keyword: StepKeyword,
    description: string,
    body: StepBody<T>,
) => test.step(`${keyword} ${description}`, body)

export const createScenarios = (test: StepCapableTest) => ({
    given: <T>(description: string, body: StepBody<T>) => runStep(test, "Given", description, body),
    when: <T>(description: string, body: StepBody<T>) => runStep(test, "When", description, body),
    then: <T>(description: string, body: StepBody<T>) => runStep(test, "Then", description, body),
    and: <T>(description: string, body: StepBody<T>) => runStep(test, "And", description, body),
    but: <T>(description: string, body: StepBody<T>) => runStep(test, "But", description, body),
})
