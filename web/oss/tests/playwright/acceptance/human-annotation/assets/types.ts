import type {BaseFixture} from "@agenta/web-tests/tests/fixtures/base.fixture/types"

export type HumanEvaluationConfig = {
    testset?: string
    variants: string
    name: string
    skipEvaluatorCreation?: boolean
    evaluatorMetricName?: string
}

export interface HumanEvaluationFixtures extends BaseFixture {
    navigateToHumanEvaluation: (appId: string) => Promise<void>
    createHumanEvaluationRun: (config: HumanEvaluationConfig) => Promise<void>
    annotateCurrentHumanScenario: (options?: {
        metricLabel?: string | RegExp
        valueLabel?: string | RegExp
    }) => Promise<void>
}
