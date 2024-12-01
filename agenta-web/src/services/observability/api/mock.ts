import {randNum} from "@/lib/helpers/utils"
import {Generation, GenerationKind, GenerationDashboardData, GenerationStatus} from "@/ee/lib/types_ee"
import dayjs from "dayjs"

const generations: Generation[] = [
    {
        id: "1",
        created_at: "2021-10-01T00:00:00Z",
        variant: {
            variant_id: "1",
            variant_name: "default",
            revision: 1,
        },
        environment: "production",
        status: GenerationStatus.OK,
        spankind: GenerationKind.LLM,
        metadata: {
            cost: 0.0001,
            latency: 0.32,
            usage: {
                total_tokens: 72,
                prompt_tokens: 25,
                completion_tokens: 47,
            },
        },
        user_id: "u-8k3j4",
        content: {
            inputs: [
                {input_name: "country", input_value: "Pakistan"},
                {input_name: "criteria", input_value: "Most population"},
            ],
            outputs: ["The most populous city in Pakistan is Karachi"],
            internals: [],
        },
    },
    {
        id: "2",
        created_at: "2023-10-01T00:00:00Z",
        variant: {
            variant_id: "2",
            variant_name: "test",
            revision: 1,
        },
        environment: "staging",
        status: GenerationStatus.ERROR,
        spankind: GenerationKind.LLM,
        metadata: {
            cost: 0.0004,
            latency: 0.845,
            usage: {
                total_tokens: 143,
                prompt_tokens: 25,
                completion_tokens: 118,
            },
        },
        user_id: "u-8k3j4",
        content: {
            inputs: [],
            outputs: [],
            internals: [],
        },
    },
    {
        id: "3",
        created_at: "2024-10-01T00:00:00Z",
        variant: {
            variant_id: "1",
            variant_name: "default",
            revision: 2,
        },
        environment: "development",
        status: GenerationStatus.OK,
        spankind: GenerationKind.LLM,
        metadata: {
            cost: 0.0013,
            latency: 0.205,
            usage: {
                total_tokens: 61,
                prompt_tokens: 25,
                completion_tokens: 36,
            },
        },
        user_id: "u-7tij2",
        content: {
            inputs: [],
            outputs: [],
            internals: [],
        },
    },
]

const generationDetail = {
    content: {
        inputs: [
            {input_name: "country", input_value: "Pakistan"},
            {input_name: "criteria", input_value: "Most population"},
        ],
        outputs: ["The most populous city in Pakistan is Karachi"],
        internals: [],
    },
    config: {
        system: "You are an expert in geography.",
        user: "What is the city of {country} with the criteria {criteria}?",
        variables: [
            {name: "country", type: "string"},
            {name: "criteria", type: "string"},
        ],
        temperature: 0.7,
        model: "gpt-3.5-turbo",
        max_tokens: 100,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0,
    },
}

const dashboardData = (count = 300): GenerationDashboardData["data"] => {
    return Array(count)
        .fill(true)
        .map(() => {
            const totalTokens = randNum(0, 600)
            const promptTokens = randNum(0, 150)
            return {
                timestamp: randNum(dayjs().subtract(30, "days").valueOf(), dayjs().valueOf()), // b/w last 30 days
                success_count: randNum(0, 20),
                failure_count: randNum(0, 5),
                latency: Math.random() * 1.5,
                cost: Math.random() * 0.01,
                total_tokens: totalTokens,
                prompt_tokens: promptTokens,
                completion_tokens: totalTokens - promptTokens,
                enviornment: ["production", "staging", "development"][randNum(0, 2)],
                variant: "default",
            }
        })
}

export const ObservabilityMock = {
    generations,
    generationDetail,
    dashboardData,
}
