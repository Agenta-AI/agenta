import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

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
