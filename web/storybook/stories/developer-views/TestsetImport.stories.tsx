import type {ReactNode} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {expect, fireEvent, waitFor, within} from "storybook/test"

import {NO_ROWS} from "../../../mobile/src/features/testsets/detail/importFileCheck"
import {ImportRevisionDialog} from "../../../mobile/src/features/testsets/detail/ImportRevisionDialog"

/**
 * The dialog that imports a CSV or JSON file as a new revision of a test set. The stories pick a
 * file through the real drop zone. Requests are not sent from these stories.
 */
const meta = {
    title: "@agenta/mobile/Developer/Testsets/Import",
    parameters: {layout: "padded"},
    decorators: [
        (Story: () => ReactNode) => (
            <QueryClientProvider client={new QueryClient()}>
                <Story />
            </QueryClientProvider>
        ),
    ],
    render: () => (
        <ImportRevisionDialog
            open
            projectId="project-1"
            testsetId="testset-1"
            testsetName="Support questions"
            currentColumns={["question", "answer", "tag"]}
            onClose={() => undefined}
            onImported={() => undefined}
        />
    ),
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const pickFile = async (canvasElement: HTMLElement, file: File) => {
    const body = within(canvasElement.ownerDocument.body)
    const input = await body.findByTestId("testset-file-input")
    await fireEvent.change(input, {target: {files: [file]}})
    return body
}

export const ImportEmpty: Story = {}

/** A valid file without the "tag" column: the dialog names it and still allows the import. */
export const ImportPreview: Story = {
    play: async ({canvasElement}) => {
        const csv = [
            "question,answer",
            "Where is my order?,It ships in two days",
            "Can I change my plan?,Yes from the billing page",
            "Do you have an API?,Yes",
        ].join("\n")
        const body = await pickFile(
            canvasElement,
            new File([csv], "support-questions.csv", {type: "text/csv"}),
        )
        await waitFor(() => expect(body.getByTestId("import-missing-columns")).toBeTruthy())
    },
}

/** A file with column names and no rows: refused, Import stays off. */
export const ImportInvalid: Story = {
    play: async ({canvasElement}) => {
        const body = await pickFile(
            canvasElement,
            new File(["question,answer\n"], "empty.csv", {type: "text/csv"}),
        )
        await body.findByText(NO_ROWS)
    },
}
