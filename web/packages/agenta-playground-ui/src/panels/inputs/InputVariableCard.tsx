import {memo, useCallback, useMemo, useState} from "react"

import {
    buildEmptyShapeFromSchema,
    getDefaultViewForExpectedType,
    getViewOptionsForExpectedType,
    type ViewType,
} from "@agenta/entity-ui/view-types"
import {useAtom} from "jotai"

import type {PlaygroundInputVariable} from "../../hooks/usePlaygroundInputsModel"
import {variableViewModeAtomFamily} from "../../state/variableViewMode"
import {buildSchemaStrictShape, mergeEditWithStash} from "../../utils/variableShape"

import {InputValueEditor} from "./InputValueEditor"
import {InputVariableCardHeader} from "./InputVariableCardHeader"

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)

export interface InputVariableCardProps {
    /** The test case row. With the variable name it keys the chosen view. */
    rowId: string
    variable: PlaygroundInputVariable
    editable: boolean
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
    onValueChange: (name: string, value: unknown) => void
}

/**
 * One input of a test case: a bordered card with the variable's name, type and view switch above
 * its editor. The card shows the keys the prompt references; keys it does not reference stay on
 * the test case and come back when the prompt references them again.
 */
export const InputVariableCard = memo(
    ({rowId, variable, editable, templateFormat, onValueChange}: InputVariableCardProps) => {
        const {name, value, expectedType, expectedSchema} = variable
        const [chosenMode, setChosenMode] = useAtom(
            variableViewModeAtomFamily({rowId, varName: name}),
        )
        const [collapsed, setCollapsed] = useState(false)

        const options = useMemo(
            () => getViewOptionsForExpectedType(value, expectedType),
            [value, expectedType],
        )
        const mode: ViewType =
            chosenMode ?? getDefaultViewForExpectedType(value, expectedType, expectedSchema)

        // The prompt's shape for an object variable: shown instead of the stored value, and the
        // stored value stays untouched until the user edits.
        const skeleton = useMemo(
            () => (expectedSchema ? buildEmptyShapeFromSchema(expectedSchema) : null),
            [expectedSchema],
        )
        const renderValue = useMemo(() => {
            if (skeleton === null) return value
            if (value === undefined || value === null || value === "") return skeleton
            return isPlainObject(value) && isPlainObject(skeleton)
                ? buildSchemaStrictShape(skeleton, value, "").merged
                : value
        }, [skeleton, value])

        const handleChange = useCallback(
            (next: unknown) =>
                onValueChange(
                    name,
                    skeleton === null ? next : mergeEditWithStash(next, value, skeleton),
                ),
            [name, onValueChange, skeleton, value],
        )

        return (
            <div
                data-testid={`input-variable-${name}`}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-solid border-border bg-card px-3 py-2"
            >
                <InputVariableCardHeader
                    name={name}
                    value={value}
                    expectedType={expectedType}
                    helpText={variable.helpText}
                    isDraft={variable.isDraft}
                    mode={mode}
                    options={options}
                    onModeChange={setChosenMode}
                    editable={editable}
                    collapsed={collapsed}
                    onToggleCollapsed={() => setCollapsed((previous) => !previous)}
                />
                {collapsed ? null : (
                    <InputValueEditor
                        mode={mode}
                        value={value}
                        renderValue={renderValue}
                        schema={expectedSchema}
                        expectedType={expectedType}
                        editable={editable}
                        templateFormat={templateFormat}
                        onChange={handleChange}
                    />
                )}
            </div>
        )
    },
)
InputVariableCard.displayName = "InputVariableCard"
