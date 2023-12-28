import {
    EvaluationSettingsTemplate,
    EvaluationStatus,
    Evaluator,
    EvaluatorConfig,
    Org,
    TestSet,
    User,
    Variant,
    _Evaluation,
    _EvaluationScenario,
} from "@/lib/Types"
import exactMatchImg from "@/media/target.png"
import similarityImg from "@/media/transparency.png"
import regexImg from "@/media/programming.png"
import webhookImg from "@/media/link.png"
import aiImg from "@/media/artificial-intelligence.png"
import codeImg from "@/media/browser.png"
import {pickRandom, stringToNumberInRange} from "@/lib/helpers/utils"
import {getTagColors} from "@/lib/helpers/colors"

const evaluatorIconsMap = {
    auto_exact_match: exactMatchImg,
    similarity: similarityImg,
    auto_regex_test: regexImg,
    auto_webhook_test: webhookImg,
    auto_ai_critique: aiImg,
    custom_code_run: codeImg,
}

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
        label: "Similarity Threshold",
    },
    {
        type: "text",
        description: "Threshold for similarity matching",
        label: "System Prompt",
    },
    {
        type: "code",
        description: "Python code for evaluation",
        label: "Code",
        default: `from typing import Dict

        def evaluate(
            app_params: Dict[str, str], 
            inputs: Dict[str, str], 
            output: str, 
            correct_answer: str
        ) -> float:
            # ...
            return 0.75  # Replace with your calculated score`,
    },
    {
        type: "boolean",
        default: false,
        description: "Whether to use the default webhook",
        label: "Use Default Webhook",
    },
    {
        type: "regex",
        description: "Regex pattern ex: ^[0-9]{3}-[0-9]{3}-[0-9]{4}$",
        label: "Regex",
    },
    {
        type: "string",
        description: "URL of the webhook",
        label: "Webhook URL",
    },
]

const evaluators: Evaluator[] = [
    {
        name: "Exact Match",
        key: "auto_exact_match",
        settings_template: {},
    },
    {
        name: "Similarity",
        key: "auto_similarity_match",
        settings_template: {
            similarity_threshold: evaluatorSettinsTemplates[0],
        },
    },
    {
        name: "Regex Test",
        key: "auto_regex_test",
        settings_template: {
            regex_pattern: evaluatorSettinsTemplates[4],
            regex_should_match: evaluatorSettinsTemplates[3],
        },
    },
    {
        name: "AI Critique",
        key: "auto_ai_critique",
        settings_template: {
            llm_app_prompt_template: evaluatorSettinsTemplates[1],
        },
    },
    {
        name: "Code Evaluation",
        key: "custom_code_run",
        settings_template: {
            custom_code_evaluation_id: evaluatorSettinsTemplates[2],
        },
    },
    {
        name: "Webhook Test",
        key: "auto_webhook_test",
        settings_template: {
            webhook_url: evaluatorSettinsTemplates[5],
        },
    },
].map((item) => ({
    ...(item as Evaluator),
    icon_url: evaluatorIconsMap[item.key as keyof typeof evaluatorIconsMap],
    color: getTagColors()[stringToNumberInRange(item.key, 0, getTagColors().length - 1)],
}))

const evaluatorConfigs: EvaluatorConfig[] = pickRandom(evaluators, 7).map((item, ix) => ({
    evaluator_key: item.key,
    id: ix + "",
    name: `Evaluator ${ix}`,
    settings_values: {},
    created_at: new Date().toString(),
}))

const evaluations: _Evaluation[] = [
    {
        id: "evaluation1",
        appId: "app1",
        user: users[0],
        testset: testsets[0],
        status: EvaluationStatus.FINISHED,
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
    {
        id: "evaluation2",
        appId: "app1",
        user: users[0],
        testset: testsets[0],
        status: EvaluationStatus.INITIALIZED,
        variants: [variants[0]],
        aggregated_results: [
            {
                evaluator_config: evaluatorConfigs[1],
                result: {
                    type: "string",
                    value: "passed",
                },
            },
        ],
        created_at: "2022-01-01T00:00:00.000Z",
        duration: 120000,
    },
    {
        id: "evaluation3",
        appId: "app1",
        user: users[0],
        testset: testsets[0],
        status: EvaluationStatus.STARTED,
        variants: [variants[0]],
        aggregated_results: [
            {
                evaluator_config: evaluatorConfigs[2],
                result: {
                    type: "string",
                    value: "valid",
                },
            },
        ],
        created_at: "2022-05-01T00:00:00.000Z",
        duration: 120000,
    },
    {
        id: "evaluation4",
        appId: "app1",
        user: users[0],
        testset: testsets[0],
        status: EvaluationStatus.ERROR,
        variants: [variants[0]],
        aggregated_results: [
            {
                evaluator_config: evaluatorConfigs[0],
                result: {
                    type: "number",
                    value: 15,
                },
            },
        ],
        created_at: "2023-05-01T00:00:00.000Z",
        duration: 2000,
    },
]

const evaluationScenarios: _EvaluationScenario[] = [
    {
        id: "evaluationScenario1",
        user: users[0],
        organization: organizations[0],
        evaluation: evaluations[0],
        inputs: [
            {
                name: "country",
                type: "text",
                value: "Sample input text",
            },
        ],
        outputs: [
            {
                type: "number",
                value: 32.5,
            },
        ],
        correct_answer: {
            type: "number",
            value: 28,
        },
        created_at: "2021-01-01T00:00:00.000Z",
        updated_at: "2021-01-01T00:00:00.000Z",
        is_pinned: false,
        note: "This is a note",
        evaluators_configs: [evaluatorConfigs[0]],
        results: [
            {
                evaluator: evaluators.find(
                    (item) => item.key === evaluatorConfigs[0].evaluator_key,
                )!,
                result: 12,
            },
        ],
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
    evaluationScenarios,
}

export default Mock
