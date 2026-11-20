// @vitest-environment jsdom
import {renderToStaticMarkup} from "react-dom/server"
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

afterEach(cleanup)

import QueuedMessagesDock from "../../src/components/QueuedMessagesDock"

describe("QueuedMessagesDock", () => {
    it("explains that a held message waits for the open answer", () => {
        const markup = renderToStaticMarkup(
            <QueuedMessagesDock
                queued={[{id: "queued-1", text: "continue afterward"}]}
                held
                onRemove={() => undefined}
            />,
        )

        expect(markup).toContain("1 queued message · waits for your answer")
        expect(markup).toContain("continue afterward")
    })
})

it.each([false, true])(
    "keeps cancel editing reachable after the edited row leaves (touch=%s)",
    (touch) => {
        const cancel = vi.fn()
        const props = {onRemove: vi.fn(), onCancelEdit: cancel, editingId: "edited", touch}
        const {rerender} = render(
            <QueuedMessagesDock {...props} queued={[{id: "edited", text: "draft"}]} />,
        )
        fireEvent.click(screen.getByRole("button", {name: "Collapse"}))
        rerender(<QueuedMessagesDock {...props} queued={[]} />)
        expect(screen.getByText("This message is no longer queued.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", {name: "Cancel editing"}))
        expect(cancel).toHaveBeenCalledOnce()
        expect(props.onRemove).not.toHaveBeenCalled()
    },
)

it("offers Remove on a just-sent row and edits an unsaved edit, not the saved text", () => {
    const remove = vi.fn()
    const edit = vi.fn()
    render(
        <QueuedMessagesDock
            queued={[
                {
                    id: "client-1",
                    text: "just sent",
                    source: "local",
                    editable: false,
                    removable: true,
                },
                {
                    id: "input-2",
                    text: "saved text",
                    source: "server",
                    error: "Your edit wasn't saved. Edit to try again.",
                    unsavedEdit: {text: "my edit"},
                },
            ]}
            onRemove={remove}
            onEdit={edit}
            touch
        />,
    )
    fireEvent.click(screen.getAllByRole("button", {name: "Remove queued message"})[0])
    expect(remove).toHaveBeenCalledWith("client-1")
    expect(screen.getByRole("alert").textContent).toBe("Your edit wasn't saved. Edit to try again.")
    fireEvent.click(screen.getAllByRole("button", {name: "Edit queued message"})[0])
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({id: "input-2", text: "my edit"}))
})

it("holds Send Now while another message is being sent, and marks the one on its way", () => {
    const sendNow = vi.fn()
    render(
        <QueuedMessagesDock
            queued={[
                {id: "a", text: "on its way", source: "server", policy: "steer"},
                {id: "b", text: "waiting", source: "server"},
            ]}
            onSendNow={sendNow}
            onRemove={vi.fn()}
            sendNowBlocked
        />,
    )
    const sending = screen.getByRole("button", {name: "Sending"}) as HTMLButtonElement
    const waiting = screen.getByRole("button", {name: "Send Now"}) as HTMLButtonElement
    expect(sending.disabled).toBe(true)
    expect(waiting.disabled).toBe(true)
    expect(waiting.title).toBe("Another message is being sent first")
})

it("shows a child update as a read-only notice that names the child session", () => {
    const remove = vi.fn()
    render(
        <QueuedMessagesDock
            queued={[
                {
                    id: "update-1",
                    text: "[Update from child session c2f1 (Email writer). ...]",
                    source: "server",
                    editable: false,
                    serverKind: "child_update",
                    childUpdate: {sessionId: "c2f1", turnId: "t1", status: "completed"},
                },
            ]}
            onRemove={remove}
            onEdit={vi.fn()}
            onSendNow={vi.fn()}
            renderChildSession={(update) => <a href={`/s/${update.sessionId}`}>Email writer</a>}
        />,
    )
    expect(screen.getByRole("link", {name: "Email writer"}).getAttribute("href")).toBe("/s/c2f1")
    expect(screen.getByText("Completed")).toBeTruthy()
    // The model-facing text never shows, and the row offers remove only.
    expect(screen.queryByText(/Update from child session c2f1/)).toBeNull()
    expect(screen.queryByRole("button", {name: "Edit queued message"})).toBeNull()
    expect(screen.queryByRole("button", {name: "Send Now"})).toBeNull()
    fireEvent.click(screen.getByRole("button", {name: "Remove queued message"}))
    expect(remove).toHaveBeenCalledWith("update-1")
})

it("labels a child update without a structured part, and keeps another server kind read-only", () => {
    render(
        <QueuedMessagesDock
            queued={[
                {id: "update-2", text: "model text", source: "server", serverKind: "child_update"},
                {id: "later-kind", text: "a reminder", source: "server", serverKind: "reminder"},
            ]}
            onRemove={vi.fn()}
            onEdit={vi.fn()}
            onSendNow={vi.fn()}
        />,
    )
    expect(screen.getByText("Update from another session")).toBeTruthy()
    expect(screen.queryByText("model text")).toBeNull()
    expect(screen.getByText("a reminder")).toBeTruthy()
    expect(screen.queryByRole("button", {name: "Edit queued message"})).toBeNull()
    expect(screen.queryByRole("button", {name: "Send Now"})).toBeNull()
    expect(screen.getAllByRole("button", {name: "Remove queued message"})).toHaveLength(2)
})
