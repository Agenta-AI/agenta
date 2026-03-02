import type {BaseFixture} from "@agenta/web-tests/tests/fixtures/base.fixture/types"
import {Locator} from "@agenta/web-tests/utils"

export type HumanEvaluationConfig = {
    testset?: string
    variants: string
    name: string
    skipEvaluatorCreation?: boolean
}

export interface HumanEvaluationFixtures extends BaseFixture {
    navigateToHumanEvaluation: (appId: string) => Promise<void>
    navigateToHumanAnnotationRun: (appId: string) => Promise<void>
    createHumanEvaluationRun: (config: HumanEvaluationConfig) => Promise<void>
    runAllScenarios: () => Promise<void>
    verifyStatusUpdate: (row: Locator) => Promise<void>
    switchToTableView: () => Promise<void>
    runScenarioFromFocusView: () => Promise<void>
    navigateBetweenScenarios: () => Promise<void>
    annotateFromFocusView: () => Promise<void>
    annotateFromTableView: () => Promise<void>
}
