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
