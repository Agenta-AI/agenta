import type {BaseFixture} from "@agenta/web-tests/tests/fixtures/base.fixture/types"

export interface EvaluatorFixtures extends BaseFixture {
    navigateToEvaluators: () => Promise<void>
}
