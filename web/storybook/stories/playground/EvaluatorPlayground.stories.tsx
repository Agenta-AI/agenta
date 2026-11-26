import {useState} from "react"

import {SelectAppEmpty} from "@/features/playground/states/SelectAppEmpty"
import {executionItemController, playgroundController} from "@agenta/playground"
import {completeRunAtom, failRunAtom, startRunAtom} from "@agenta/playground/state"
import {RunOnSelector, type RunOnMode} from "@agenta/playground-ui/panels/evaluator"
import {RunsPanel, TestsetMenu} from "@agenta/playground-ui/panels/runs"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {getDefaultStore} from "jotai"
import {expect, fn, userEvent, within} from "storybook/test"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {workflowIds} from "../../fixtures/workflow"

import {withAppBoxSizing} from "./borderBox"
import {promptRevisionQueries, selectRevision} from "./playgroundFixtures"
import {testsetMenuModel} from "./testsetMenuModel"

/**
 * The /m evaluator playground pieces: the "Run on" control, the run pane before an app is
 * connected, and a test case of an app with two evaluators after it, one scored and one failed.
 * The run pane story is data-connected: the app revision comes from the seeded query cache.
 */
const RunOnDemo = ({mode}: {mode: RunOnMode}) => {
    const [current, setCurrent] = useState(mode)
    return (
        <div className="flex bg-background p-4 text-foreground">
            <RunOnSelector mode={current} onPick={setCurrent} />
        </div>
    )
}

/** The app's run, then the two evaluators' results, written the way a chain run writes them. */
const ScoredDemo = ({revisionId, phone = false}: {revisionId: string; phone?: boolean}) => {
    useState(() => {
        selectRevision(revisionId)
        const store = getDefaultStore()
        const [root] = store.get(playgroundController.selectors.nodes())
        for (const [id, label] of [
            ["story-evaluator-1", "Exact match"],
            ["story-evaluator-2", "Answer quality"],
        ]) {
            store.set(playgroundController.actions.connectDownstreamNode, {
                sourceNodeId: root.id,
                entity: {type: "workflow", id, label},
            })
        }
        const loadableId = store.get(playgroundController.selectors.loadableId())
        const [stepId] = store.get(executionItemController.selectors.executionRowIds) as string[]
        const run = (sessionId: string, data: unknown) => {
            store.set(startRunAtom, {loadableId, stepId, sessionId, runId: "story-run"})
            store.set(completeRunAtom, {
                loadableId,
                stepId,
                sessionId,
                result: {output: {response: {data}}},
            })
        }
        run(`sess:${revisionId}`, "Paris")
        run(`sess:${revisionId}:story-evaluator-1`, {outputs: {score: 1, success: true}})
        store.set(startRunAtom, {
            loadableId,
            stepId,
            sessionId: `sess:${revisionId}:story-evaluator-2`,
            runId: "story-run",
        })
        store.set(failRunAtom, {
            loadableId,
            stepId,
            sessionId: `sess:${revisionId}:story-evaluator-2`,
            error: {message: "The model returned no score"},
        })
    })
    return (
        <div
            data-testid="run-pane"
            className={`h-[640px] overflow-y-auto border border-border bg-background text-foreground ${phone ? "w-[390px]" : "w-full max-w-[720px]"}`}
        >
            <RunsPanel
                revisionId={revisionId}
                testsetMenu={
                    phone ? (
                        <TestsetMenu
                            model={testsetMenuModel({
                                isConnected: true,
                                label: "qa-countries (v1)",
                            })}
                        />
                    ) : undefined
                }
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/EvaluatorPlayground",
    component: RunOnDemo,
    parameters: {layout: "fullscreen"},
    args: {mode: "app"},
} satisfies Meta<typeof RunOnDemo>

export default meta
type Story = StoryObj<typeof meta>

export const RunOnAppOutput: Story = {
    play: async ({canvasElement}) => {
        await userEvent.click(within(canvasElement).getByRole("button"))
        await within(canvasElement.ownerDocument.body).findByText(
            "What should the evaluator run on?",
        )
    },
}

export const RunOnTestCase: Story = {args: {mode: "data"}}

export const SelectAnApp: Story = {
    render: () => (
        <div className="h-[480px] bg-background text-foreground">
            <SelectAppEmpty onSelect={fn()} />
        </div>
    ),
}

export const ScoredTestCase: Story = {
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => promptRevisionQueries(scope),
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
    render: (_args, context) => (
        <ScoredDemo revisionId={(context.args as unknown as {revisionId: string}).revisionId} />
    ),
}

/**
 * At 390 px the header wraps under "Generations": the test set, Clear and Run all stay inside
 * the pane, and the pane never scrolls sideways, so no card is cut off.
 */
export const ScoredTestCasePhone: Story = {
    decorators: [withAppBoxSizing],
    parameters: ScoredTestCase.parameters,
    render: (_args, context) => (
        <ScoredDemo
            phone
            revisionId={(context.args as unknown as {revisionId: string}).revisionId}
        />
    ),
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        const pane = await canvas.findByTestId("run-pane")
        const runAll = await canvas.findByRole("button", {name: /Run all/})
        await canvas.findByText("Exact match")
        expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth)
        expect(runAll.getBoundingClientRect().right).toBeLessThanOrEqual(
            pane.getBoundingClientRect().right,
        )
    },
}
