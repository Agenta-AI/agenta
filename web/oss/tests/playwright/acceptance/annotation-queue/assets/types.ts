import type {BaseFixture} from "@agenta/web-tests/tests/fixtures/base.fixture/types"

export interface AnnotationQueueFixtures extends BaseFixture {
    navigateToAnnotations: () => Promise<void>
    createAnnotationQueue: (config: {name: string; kind: "traces" | "testcases"}) => Promise<void>
}
