import type {ReactNode} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {expect, fireEvent, userEvent, waitFor, within} from "storybook/test"

import {CreateTestsetDialog} from "../../../mobile/src/features/testsets/create/CreateTestsetDialog"
import {
    INVALID_JSON,
    UNSUPPORTED_FORMAT,
} from "../../../mobile/src/features/testsets/create/testsetFileCheck"
import {TestsetFileDrop} from "../../../mobile/src/features/testsets/create/TestsetFileDrop"
import {TestsetNameDialog} from "../../../mobile/src/features/testsets/create/TestsetNameDialog"

/**
 * The create flow for a test set: the file drop and its states, the create dialog with its three
 * steps, and the clone and rename dialog. Requests are not sent from these stories.
 */
const meta = {
    title: "@agenta/mobile/Developer/Testsets/Create",
    parameters: {layout: "padded"},
    decorators: [
        (Story: () => ReactNode) => (
            <QueryClientProvider client={new QueryClient()}>
                <Story />
            </QueryClientProvider>
        ),
    ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined
const CSV = "question,answer\nWhere is my order?,It ships in two days\n"

const PREVIEW_ROWS = [
    {question: "Where is my order?", answer: "It ships in two days", tag: "shipping"},
    {question: "Can I change my plan?", answer: "Yes from the billing page", tag: "billing"},
    {question: "How do I reset my password?", answer: "Use the link on the sign-in page", tag: ""},
    {question: "Do you have an API?", answer: "Yes", tag: "api"},
    {question: "Who can see my data?", answer: "Only members of your project", tag: "privacy"},
]

const Frame = ({children}: {children: ReactNode}) => (
    <div className="w-[440px] max-w-full rounded-lg border border-solid border-border p-4">
        {children}
    </div>
)

export const DropEmpty: Story = {
    render: () => (
        <Frame>
            <TestsetFileDrop file={null} preview={[]} error={null} onFile={noop} onRemove={noop} />
        </Frame>
    ),
}

export const DropUnsupported: Story = {
    render: () => (
        <Frame>
            <TestsetFileDrop
                file={null}
                preview={[]}
                error={UNSUPPORTED_FORMAT}
                onFile={noop}
                onRemove={noop}
            />
        </Frame>
    ),
}

export const DropInvalid: Story = {
    render: () => (
        <Frame>
            <TestsetFileDrop
                file={null}
                preview={[]}
                error={INVALID_JSON}
                onFile={noop}
                onRemove={noop}
            />
        </Frame>
    ),
}

export const DropPreview: Story = {
    render: () => (
        <Frame>
            <TestsetFileDrop
                file={new File([CSV], "support-questions.csv")}
                preview={PREVIEW_ROWS}
                error={null}
                onFile={noop}
                onRemove={noop}
            />
        </Frame>
    ),
}

const dialogProps = {projectId: "project-1", base: "/w/workspace-1/p/project-1", onClose: noop}

export const ChooseStep: Story = {
    render: () => <CreateTestsetDialog {...dialogProps} />,
}

export const UploadReady: Story = {
    render: () => <CreateTestsetDialog {...dialogProps} />,
    play: async ({canvasElement}) => {
        const body = within(canvasElement.ownerDocument.body)
        const input = await body.findByTestId("testset-file-input")
        const rows = [
            "question,answer,tag",
            ...PREVIEW_ROWS.map((row) => Object.values(row).join(",")),
        ]
        const file = new File([rows.join("\n")], "support-questions.csv", {type: "text/csv"})
        await fireEvent.change(input, {target: {files: [file]}})
        await waitFor(() => expect(body.getByDisplayValue("support-questions")).toBeTruthy())
    },
}

export const UploadUnsupported: Story = {
    render: () => <CreateTestsetDialog {...dialogProps} />,
    play: async ({canvasElement}) => {
        const body = within(canvasElement.ownerDocument.body)
        const input = await body.findByTestId("testset-file-input")
        await fireEvent.change(input, {
            target: {files: [new File(["hello"], "notes.txt", {type: "text/plain"})]},
        })
        await body.findByText(UNSUPPORTED_FORMAT)
    },
}

export const ScratchStep: Story = {
    render: () => <CreateTestsetDialog {...dialogProps} />,
    play: async ({canvasElement}) => {
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(await body.findByText("New via UI"))
        await userEvent.type(await body.findByPlaceholderText("Enter a name"), "Refund questions")
    },
}

export const ApiStepCsv: Story = {
    render: () => <CreateTestsetDialog {...dialogProps} />,
    play: async ({canvasElement}) => {
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(await body.findByText("Create via API"))
        await body.findByTestId("testset-api-snippet")
    },
}

export const ApiStepJson: Story = {
    render: () => <CreateTestsetDialog {...dialogProps} />,
    play: async ({canvasElement}) => {
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(await body.findByText("Create via API"))
        await userEvent.click(await body.findByText("JSON"))
        await userEvent.click(await body.findByText("cURL"))
        await expect(await body.findByTestId("testset-api-snippet")).toHaveTextContent(
            "your-testset-slug",
        )
    },
}

export const CloneDialog: Story = {
    render: () => (
        <TestsetNameDialog
            mode="clone"
            testset={{id: "t-1", name: "Refund questions"}}
            {...dialogProps}
        />
    ),
}

export const RenameDialog: Story = {
    render: () => (
        <TestsetNameDialog
            mode="rename"
            testset={{id: "t-1", name: "Refund questions"}}
            {...dialogProps}
        />
    ),
}
