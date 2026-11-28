// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {ScenarioFilterCondition} from "@/features/evaluation-run/scenarios/ScenarioFilterCondition"
import type {ScenarioFilterField} from "@/features/evaluation-run/scenarios/useScenarioFilter"

const field: ScenarioFilterField = {
    id: "evaluator|bench-check|found-hidden-preferences · passed",
    groupKind: "evaluator",
    groupSlug: "bench-check",
    columnName: "found-hidden-preferences · passed",
    groupLabel: "Bench check",
    label: "found-hidden-preferences · passed",
    valueType: "boolean",
    operators: ["eq", "ne"],
}

afterEach(cleanup)

describe("ScenarioFilterCondition with a long column name", () => {
    it("keeps the column label on one line and shows the full name on hover", () => {
        render(
            <ScenarioFilterCondition
                index={0}
                condition={{
                    groupKind: field.groupKind,
                    groupSlug: field.groupSlug,
                    columnName: field.columnName,
                    op: "eq",
                    value: "",
                }}
                join="and"
                fields={[field]}
                onJoinChange={() => {}}
                onChange={() => {}}
                onRemove={() => {}}
            />,
        )
        const trigger = screen.getByRole("combobox", {name: "Column of condition 1"})
        expect(trigger.getAttribute("title")).toBe(
            "Bench check · found-hidden-preferences · passed",
        )
        const valueSlot = trigger.querySelector("[data-slot=select-value]")
        expect(valueSlot?.textContent).toContain("found-hidden-preferences · passed")
        // The trigger styles the value slot with the truncate classes (one line, ellipsis).
        expect(trigger.className).toContain("[&>[data-slot=select-value]]:truncate")
        expect(trigger.className).toContain("[&>[data-slot=select-value]]:min-w-0")
    })

    it("has no title while no column is picked", () => {
        render(
            <ScenarioFilterCondition
                index={0}
                condition={{groupKind: "evaluator", columnName: "", op: "eq", value: ""} as never}
                join="and"
                fields={[field]}
                onJoinChange={() => {}}
                onChange={() => {}}
                onRemove={() => {}}
            />,
        )
        const trigger = screen.getByRole("combobox", {name: "Column of condition 1"})
        expect(trigger.hasAttribute("title")).toBe(false)
    })
})
