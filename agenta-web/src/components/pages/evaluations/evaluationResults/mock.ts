import {
    EvaluationSettingsTemplate,
    Evaluator,
    EvaluatorConfig,
    Org,
    TestSet,
    User,
    Variant,
    _Evaluation,
} from "@/lib/Types"
import exactMatchImg from "@/media/target.png"
import similarityImg from "@/media/transparency.png"
import regexImg from "@/media/programming.png"
import webhookImg from "@/media/link.png"
import aiImg from "@/media/artificial-intelligence.png"
import codeImg from "@/media/browser.png"
import {PresetColors} from "antd/es/theme/internal"
import {stringToNumberInRange} from "@/lib/helpers/utils"

const organizations: Org[] = [
    {
        id: "org1",
        name: "Organization 1",
        description: "This is the description of organization 1",
        owner: "user1",
    },
]

const users: User[] = [
    {
        id: "user1",
        uid: "user1",
        username: "user1",
        email: "user1@test.com",
    },
]

const testsets: TestSet[] = [
    {
        id: "testset1",
        name: "Test Set 1",
        created_at: "2021-01-01T00:00:00.000Z",
        updated_at: "2021-01-01T00:00:00.000Z",
        csvdata: [],
    },
]

const variants: Variant[] = [
    {
        variantName: "variant1",
        templateVariantName: "variant1",
        persistent: false,
        parameters: {},
        previousVariantName: null,
        variantId: "variant1",
        baseId: "variant1",
        baseName: "variant1",
        configId: "config1",
        configName: "config1",
    },
]

const evaluatorSettinsTemplates: EvaluationSettingsTemplate[] = [
    {
        type: "number",
        default: 0.5,
        description: "Threshold for similarity matching",
    },
]

const evaluators: Evaluator[] = [
    {
        name: "Exact Match",
        key: "auto_exact_match",
        settings_template: {},
        icon_url: exactMatchImg,
    },
    {
        name: "Similarity",
        key: "similarity",
        settings_template: {
            similarity_threshold: evaluatorSettinsTemplates[0],
        },
        icon_url: similarityImg,
    },
    {
        name: "Regex Test",
        key: "auto_regex_test",
        settings_template: {},
        icon_url: regexImg,
    },
    {
        name: "AI Critique",
        key: "auto_ai_critique",
        settings_template: {},
        icon_url: aiImg,
    },
    {
        name: "Code Evaluation",
        key: "custom_code_run",
        settings_template: {},
        icon_url: codeImg,
    },
    {
        name: "Webhook test",
        key: "auto_webhook_test",
        settings_template: {},
        icon_url: webhookImg,
    },
].map((item) => ({
    ...(item as Evaluator),
    color: PresetColors[stringToNumberInRange(item.key, 0, PresetColors.length - 1)],
}))

const evaluatorConfigs: EvaluatorConfig[] = [
    {
        evaluator_key: "similarity",
        name: "Nearly Similar",
        settings_values: {
            similarity_threshold: 0.4,
        },
        created_at: "2021-01-01T00:00:00.000Z",
        id: "config1",
    },
]

const evaluations: _Evaluation[] = [
    {
        id: "evaluation1",
        organization: organizations[0],
        user: users[0],
        testset: testsets[0],
        status: "completed",
        variants: [variants[0]],
        aggregated_results: [
            {
                evaluator_config: evaluatorConfigs[0],
                result: {
                    type: "number",
                    value: 32.5,
                },
            },
        ],
        created_at: "2021-01-01T00:00:00.000Z",
        duration: 50000,
    },
]

const Mock = {
    organizations,
    users,
    testsets,
    variants,
    evaluatorSettinsTemplates,
    evaluators,
    evaluatorConfigs,
    evaluations,
}

export default Mock
