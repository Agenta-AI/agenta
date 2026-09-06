/**
 * @vitest-environment jsdom
 */
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {DEFAULT_ATTACHMENT_LIMITS} from "../../src/assets/attachmentRules"
import {isComposerRunStoppable} from "../../src/assets/composerRunState"
import {ChatComposer} from "../../src/components/ChatComposer"
import QueuedMessagesDock from "../../src/components/QueuedMessagesDock"
import type {useComposerAttachments} from "../../src/hooks/useComposerAttachments"

afterEach(cleanup)

const attachments = {
    uploadsEnabled: false,
    files: [],
    rejections: [],
    limits: DEFAULT_ATTACHMENT_LIMITS,
    atMax: false,
    attachmentsSettled: true,
    uploadBlockReason: undefined,
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    dismissRejection: vi.fn(),
    uploads: {retry: vi.fn(), canRetry: vi.fn()},
} as unknown as ReturnType<typeof useComposerAttachments>

const renderComposer = async ({
    localStreaming,
    serverBusy = false,
    serverControlEnabled = false,
    queued = false,
    busyActions,
}: {
    localStreaming: boolean
    serverBusy?: boolean
    serverControlEnabled?: boolean
    queued?: boolean
    busyActions?: {label: string; onSubmit: (text: string) => void}[]
}) => {
    const onStop = vi.fn()
    const streaming = isComposerRunStoppable({
        localStreaming,
        serverBusy,
        serverControlEnabled,
        waitingOnUser: false,
    })
    render(
        <>
            {queued ? (
                <QueuedMessagesDock
                    queued={[
                        {
                            id: "queued-1",
                            text: "run this next",
                            source: "server",
                            editable: false,
                        },
                    ]}
                    held={false}
                    onRemove={vi.fn()}
                />
            ) : null}
            <ChatComposer
                onSubmit={vi.fn()}
                attachments={attachments}
                streaming={streaming}
                onStop={onStop}
                busyActions={busyActions}
            />
        </>,
    )
    await screen.findByRole("button", {name: "Stop"}, {timeout: 5_000})
    return onStop
}

describe("ChatComposer running controls", () => {
    it("keeps Stop and Escape on a fresh session's first running turn", async () => {
        const onStop = await renderComposer({localStreaming: true})

        expect(screen.getByRole("button", {name: "Stop"}).getAttribute("aria-keyshortcuts")).toBe(
            "Escape",
        )
        fireEvent.keyDown(document, {key: "Escape"})
        expect(onStop).toHaveBeenCalledOnce()
    })

    it("keeps Stop and Escape beside Queue and Steer for a durable queued turn", async () => {
        const onStop = await renderComposer({
            localStreaming: false,
            serverBusy: true,
            serverControlEnabled: true,
            queued: true,
            busyActions: [
                {label: "Queue", onSubmit: vi.fn()},
                {label: "Steer", onSubmit: vi.fn()},
            ],
        })

        expect(screen.getByText("1 queued message")).toBeTruthy()
        expect(screen.getByRole("button", {name: "Queue"})).toBeTruthy()
        expect(screen.getByRole("button", {name: "Steer"})).toBeTruthy()
        expect(screen.getByRole("button", {name: "Stop"})).toBeTruthy()
        fireEvent.keyDown(document, {key: "Escape"})
        expect(onStop).toHaveBeenCalledOnce()
    })

    it("keeps a flag-off remote run out of the desktop composer controls", () => {
        const onStop = vi.fn()
        const streaming = isComposerRunStoppable({
            localStreaming: false,
            serverBusy: true,
            serverControlEnabled: false,
            waitingOnUser: false,
        })

        render(
            <ChatComposer
                onSubmit={vi.fn()}
                attachments={attachments}
                streaming={streaming}
                onStop={onStop}
            />,
        )

        expect(screen.queryByRole("button", {name: "Stop"})).toBeNull()
        fireEvent.keyDown(document, {key: "Escape"})
        expect(onStop).not.toHaveBeenCalled()
    })
})

describe("queued row Send Now", () => {
    it("targets the chosen row and retains every row when admission fails", async () => {
        const sendNow = vi.fn().mockRejectedValue(new Error("unavailable"))
        const remove = vi.fn()
        render(
            <QueuedMessagesDock
                queued={[
                    {id: "older", text: "older message", source: "server"},
                    {id: "selected", text: "chosen message", source: "server"},
                ]}
                onSendNow={sendNow}
                onRemove={remove}
                touch
            />,
        )
        fireEvent.click(screen.getAllByRole("button", {name: "Send Now"})[1])
        expect(await screen.findByRole("alert")).toBeTruthy()
        expect(sendNow).toHaveBeenCalledWith("selected")
        expect(remove).not.toHaveBeenCalled()
        expect(screen.getByText("older message")).toBeTruthy()
        expect(screen.getByText("chosen message")).toBeTruthy()
        sendNow.mockResolvedValueOnce(undefined)
        fireEvent.click(screen.getAllByRole("button", {name: "Send Now"})[1])
        expect(sendNow).toHaveBeenCalledTimes(2)
    })

    it("does not offer the server action on a local fallback row", () => {
        render(<QueuedMessagesDock queued={[{id: "local", text: "draft", source: "local"}]} onSendNow={vi.fn()} onRemove={vi.fn()} />)
        expect(screen.queryByRole("button", {name: "Send Now"})).toBeNull()
    })
})
