import {useState} from "react"

import {RunResult} from "@agenta/playground-ui/panels/runs"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * What one run shows in the /m prompt playground: the hint before the first run, a spinner while
 * it runs, then the output (text, JSON or a tool call) or the error. Several repeats get a pager.
 */
const meta = {
    title: "@agenta/mobile/Developer/Playground/RunResult",
    component: RunResult,
    decorators: [
        (Story) => (
            <div className="w-full max-w-[560px] bg-background p-4 text-foreground">
                <Story />
            </div>
        ),
    ],
    args: {isRunning: false, result: null, traceId: null},
} satisfies Meta<typeof RunResult>

export default meta
type Story = StoryObj<typeof meta>

const output = (data: unknown) => ({response: {data}})
const traceFooter = (traceId: string) => (
    <p className="mt-2 text-xs text-muted-foreground">Trace {traceId} · 1.2s · 84 tokens</p>
)

/** Before the first run. */
export const Idle: Story = {}

/** The first run is going. */
export const Running: Story = {args: {isRunning: true}}

/** A run again: the old output stays under a Re-running line. */
export const Rerunning: Story = {
    args: {isRunning: true, result: output("Paris is the capital of France.")},
}

export const Text: Story = {
    args: {
        result: output("Paris is the capital of France."),
        traceId: "t-1",
        renderTraceFooter: traceFooter,
    },
}

export const Json: Story = {
    args: {result: output('{"city": "Paris", "country": "France", "population": 2102650}')},
}

export const ToolCall: Story = {
    args: {
        result: output({
            tool_calls: [
                {
                    id: "call-1",
                    type: "function",
                    function: {name: "get_weather", arguments: '{"city": "Paris"}'},
                },
            ],
        }),
    },
}

/** A generic message gives way to the API's detail, with the retry delay. */
export const Error: Story = {
    args: {
        result: {
            error: "An unknown error occurred",
            metadata: {rawError: {detail: "Rate limit reached."}, retryAfter: 20},
        },
        traceId: "t-2",
        renderTraceFooter: traceFooter,
    },
}

const answers = ["Paris", "Paris, France", "The capital of France is Paris."]

const RepeatsDemo = () => {
    const [current, setCurrent] = useState(1)
    return (
        <RunResult
            isRunning={false}
            traceId={null}
            result={output(answers[current - 1])}
            repeats={{
                current,
                total: answers.length,
                onPrev: () => setCurrent((n) => Math.max(1, n - 1)),
                onNext: () => setCurrent((n) => Math.min(answers.length, n + 1)),
            }}
        />
    )
}

export const Repeats: Story = {render: () => <RepeatsDemo />}
