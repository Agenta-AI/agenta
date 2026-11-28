import type {ReactNode} from "react"

import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

const entityPickerCalls: Record<string, unknown>[] = []
const tooltipCalls: Record<string, unknown>[] = []

vi.mock("@agenta/entity-ui", () => ({
    EntityPicker: (props: Record<string, unknown>) => {
        entityPickerCalls.push(props)
        return <div data-testid="entity-picker" />
    },
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

vi.mock("next/dynamic", () => ({
    default: () => () => <div data-testid="testset-dropdown" />,
}))

vi.mock("./RunOnSelector", () => ({
    default: () => <div data-testid="run-on-selector" />,
}))

vi.mock("./useEvaluatorRunControls", () => ({
    useEvaluatorRunControls: () => ({
        appWorkflowAdapter: {},
        handleAppSelect: vi.fn(),
        disconnectApp: vi.fn(),
        runOnMode: "app",
        handlePickRunOn: vi.fn(),
        hasAppConnected: true,
        selectedAppLabel: "My App",
    }),
}))

import EvaluatorRunControls from "./EvaluatorRunControls"

describe("EvaluatorRunControls", () => {
    it("aligns the app picker popover to bottomRight and clears tooltip leave delay", () => {
        entityPickerCalls.length = 0
        tooltipCalls.length = 0

        renderToStaticMarkup(<EvaluatorRunControls />)

        expect(entityPickerCalls).toHaveLength(1)
        expect(entityPickerCalls[0].placement).toBe("bottomRight")

        expect(tooltipCalls).toHaveLength(1)
        expect(tooltipCalls[0].mouseLeaveDelay).toBe(0)
    })
})
