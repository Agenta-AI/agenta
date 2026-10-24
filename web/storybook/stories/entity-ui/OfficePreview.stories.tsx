import {useMemo} from "react"

import {DriveFileContentViewer, DriveFileSourceContext} from "@agenta/entity-ui/drive"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, within} from "storybook/test"

import {DECK_PPTX, FORMULAS_XLSX, REPORT_DOCX, VALUES_XLSX} from "./officeFixtures"

// The spreadsheet, document and presentation previews on local bytes: no mount, no network.
const meta = {
    title: "@agenta/entity-ui/Drive/Office previews",
    parameters: {layout: "padded"},
} satisfies Meta

export default meta
type Story = StoryObj

const fromBase64 = (data: string): Uint8Array<ArrayBuffer> =>
    Uint8Array.from(atob(data), (c) => c.charCodeAt(0))

const Preview = ({
    name,
    bytes,
    size,
}: {
    name: string
    bytes: Uint8Array<ArrayBuffer>
    size?: number
}) => {
    const source = useMemo(() => {
        const file = new File([bytes], name)
        return new Map([[name, {objectUrl: URL.createObjectURL(file), file}]])
    }, [name, bytes])
    return (
        <DriveFileSourceContext.Provider value={source}>
            <div className="flex h-[520px] w-[760px] flex-col rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3">
                <DriveFileContentViewer mount={null} path={name} size={size ?? bytes.length} />
            </div>
        </DriveFileSourceContext.Provider>
    )
}

const NOT_OFFICE = new TextEncoder().encode("Region,Q1\nNorth,120\n")

/** Two sheets with stored values; the first sheet is selected. */
export const SpreadsheetLoaded: Story = {
    render: () => <Preview name="sales.xlsx" bytes={fromBase64(VALUES_XLSX)} />,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByRole("tab", {name: "Sales"})).toBeInTheDocument()
        await expect(canvas.getByRole("tab", {name: "Notes"})).toBeInTheDocument()
        await expect(canvas.getByText("260")).toBeInTheDocument()
    },
}

/** Written by openpyxl: no stored values, so the Total column shows its formulas, muted. */
export const SpreadsheetFormulaOnly: Story = {
    render: () => <Preview name="repro-sales.xlsx" bytes={fromBase64(FORMULAS_XLSX)} />,
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByText("=B4+C4")).toBeInTheDocument()
    },
}

export const SpreadsheetTooLarge: Story = {
    render: () => <Preview name="huge.xlsx" bytes={NOT_OFFICE} size={40 * 1024 * 1024} />,
    play: async ({canvasElement}) => {
        await expect(
            await within(canvasElement).findByText(/Too large to preview/),
        ).toBeInTheDocument()
    },
}

export const SpreadsheetUnreadable: Story = {
    render: () => <Preview name="renamed.xlsx" bytes={NOT_OFFICE} />,
    play: async ({canvasElement}) => {
        await expect(
            await within(canvasElement).findByText("Couldn't preview this spreadsheet"),
        ).toBeInTheDocument()
    },
}

/** A heading, three paragraphs, a `javascript:` link (plain text) and a web link. */
export const DocumentLoaded: Story = {
    render: () => <Preview name="report.docx" bytes={fromBase64(REPORT_DOCX)} />,
}

export const DocumentTooLarge: Story = {
    render: () => <Preview name="huge.docx" bytes={NOT_OFFICE} size={40 * 1024 * 1024} />,
}

export const DocumentUnreadable: Story = {
    render: () => <Preview name="renamed.docx" bytes={NOT_OFFICE} />,
    play: async ({canvasElement}) => {
        await expect(
            await within(canvasElement).findByText("Couldn't preview this document", undefined, {
                timeout: 10_000,
            }),
        ).toBeInTheDocument()
    },
}

/** Three slides, one at a time, with host-side controls. */
export const PresentationLoaded: Story = {
    render: () => <Preview name="deck.pptx" bytes={fromBase64(DECK_PPTX)} />,
}

export const PresentationTooLarge: Story = {
    render: () => <Preview name="huge.pptx" bytes={NOT_OFFICE} size={40 * 1024 * 1024} />,
}

export const PresentationUnreadable: Story = {
    render: () => <Preview name="renamed.pptx" bytes={NOT_OFFICE} />,
}
