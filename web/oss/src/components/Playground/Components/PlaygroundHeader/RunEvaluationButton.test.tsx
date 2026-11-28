import type {ReactElement, ReactNode} from "react"

import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

const tooltipCalls: Record<string, unknown>[] = []

vi.mock("@agenta/playground-ui/hooks", () => ({
    usePlaygroundLayout: () => ({displayedEntities: []}),
}))

vi.mock("@/oss/state/app", async () => {
    const {atom} = await vi.importActual<typeof import("jotai")>("jotai")
    return {
        currentAppAtom: atom(null),
    }
})

vi.mock("next/dynamic", () => ({
    default: () => () => null,
}))

vi.mock("antd", async () => {
    const actual = await vi.importActual<typeof import("antd")>("antd")
    return {
        ...actual,
        Tooltip: (props: Record<string, unknown> & {children?: ReactNode}) => {
            tooltipCalls.push(props)
            return <div data-testid="tooltip">{props.children}</div>
        },
    }
})

import RunEvaluationButton from "./RunEvaluationButton"

describe("RunEvaluationButton", () => {
    it("wraps the disabled button in a span and sets mouseLeaveDelay={0} on Tooltip", () => {
        tooltipCalls.length = 0

        const html = renderToStaticMarkup(<RunEvaluationButton />)

        expect(tooltipCalls).toHaveLength(1)
        expect(tooltipCalls[0].mouseLeaveDelay).toBe(0)

        const tooltipChild = tooltipCalls[0].children as ReactElement
        expect(tooltipChild.type).toBe("span")
        expect(html).toContain("disabled")
    })
})
