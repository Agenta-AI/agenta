import {useEffect} from "react"

import {RefinePromptDialog} from "@agenta/playground-ui/panels/refine"
import {axios} from "@agenta/shared/api"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, waitFor, within} from "storybook/test"

import type {StoryScope} from "../../.storybook/decorators/withAgentaData"
import {workflowIds} from "../../fixtures/workflow"

import {promptRevisionQueries} from "./playgroundFixtures"

type Answer = "refined" | "waiting" | "failed"

const refined = {
    isError: false,
    content: [{type: "text", text: "ok"}],
    structuredContent: {
        messages: [
            {
                role: "system",
                content:
                    "You are a geography assistant. Reply with the capital city only, with no extra words.",
            },
            {role: "user", content: "Name the capital of {{country}}."},
        ],
        summary: "Made the system message stricter and the question shorter.",
    },
}

/**
 * Answers the refine tool's request in the browser, so the story never reaches the network.
 * Removed when the story unmounts.
 */
const useRefineAnswer = (answer: Answer) => {
    useEffect(() => {
        const id = axios.interceptors.request.use((config) => {
            if (!config.url?.endsWith("/ai/services/tools/call")) return config
            config.adapter = () =>
                answer === "refined"
                    ? Promise.resolve({
                          data: refined,
                          status: 200,
                          statusText: "OK",
                          headers: {},
                          config,
                      })
                    : answer === "failed"
                      ? Promise.reject(new Error("Request failed with status code 503"))
                      : new Promise(() => undefined)
            return config
        })
        return () => axios.interceptors.request.eject(id)
    }, [answer])
}

/** The Refine prompt dialog of the /m playground, on a seeded prompt revision. */
const Demo = ({revisionId, answer}: {revisionId: string; answer: Answer}) => {
    useRefineAnswer(answer)
    return (
        <RefinePromptDialog revisionId={revisionId} promptKey="prompt" onClose={() => undefined} />
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/RefinePromptDialog",
    component: Demo,
    parameters: {
        layout: "fullscreen",
        agenta: {
            queries: (scope: StoryScope) => promptRevisionQueries(scope),
            args: (scope: StoryScope) => ({revisionId: workflowIds(scope).revisionId}),
        },
    },
    args: {revisionId: "", answer: "refined"},
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

const page = () => within(document.body)

const send = async (text: string) => {
    const box = await page().findByPlaceholderText("Describe how to refine your prompt…")
    await userEvent.type(box, text)
    await userEvent.click(page().getByRole("button", {name: "Send"}))
}

/** Opened: no instructions yet, the suggestion, and nothing to use. */
export const Empty: Story = {
    play: async () => {
        await page().findByText("Describe how you want to refine your prompt")
        await expect(page().getByRole("button", {name: "Use refined prompt"})).toBeDisabled()
    },
}

/** The refine tool is working on the instructions. */
export const Waiting: Story = {
    args: {answer: "waiting"},
    play: async () => {
        await send("Make it stricter")
        await page().findByText("Refining prompt…")
    },
}

/** The refined messages, ready to edit or use. On a phone the dialog shows them after a result. */
export const Result: Story = {
    play: async () => {
        await send("Make it stricter")
        await page().findByText("Made the system message stricter and the question shorter.")
        await waitFor(() =>
            expect(page().getByRole("button", {name: "Use refined prompt"})).toBeEnabled(),
        )
    },
}

/** The diff between the saved messages and the refined ones. */
export const Diff: Story = {
    play: async () => {
        await send("Make it stricter")
        const toggle = page().getByRole("switch", {name: "Toggle diff view"})
        await waitFor(() => expect(toggle).toBeEnabled())
        await userEvent.click(toggle)
        await waitFor(() => expect(toggle).toBeChecked())
    },
}

/** The request failed: a plain message, and the instructions box is ready again. */
export const Failed: Story = {
    args: {answer: "failed"},
    play: async () => {
        await send("Make it stricter")
        await page().findByText("Couldn't refine the prompt. Try again.")
    },
}
