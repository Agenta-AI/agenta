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
import {
    buildSchemaStrictShape,
    mergeEditWithStash,
    type ShapeConflict,
    type StashedPath,
} from "../../utils/variableShape"

import {InputValueEditor} from "./InputValueEditor"
import {InputVariableCardHeader} from "./InputVariableCardHeader"
import {ShapeConflictBanner} from "./ShapeConflictBanner"
import {StashedKeysToggle} from "./StashedKeysToggle"

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)

/** Sets a value at a dotted path and returns a new object. */
const setAtPath = (
    target: Record<string, unknown>,
    path: string,
    value: unknown,
): Record<string, unknown> => {
    const dot = path.indexOf(".")
    if (dot === -1) return {...target, [path]: value}
    const head = path.slice(0, dot)
    const child = target[head]
    return {
        ...target,
        [head]: setAtPath(isPlainObject(child) ? child : {}, path.slice(dot + 1), value),
    }
}

const NO_CONFLICTS: ShapeConflict[] = []
const NO_STASH: StashedPath[] = []

export interface InputVariableCardProps {
    /** The test case row. With the variable name it keys the chosen view. */
    rowId: string
    variable: PlaygroundInputVariable
    editable: boolean
    /** Set when the row comes from a connected test set: the card says so in its header. */
    connectedSourceName?: string | null
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
    onValueChange: (name: string, value: unknown) => void
}

/**
 * One input of a test case: a bordered card with the variable's name, type and view switch above
 * its editor. The card shows the keys the prompt references; keys it does not reference stay on
 * the test case and come back when the prompt references them again.
 */
export const InputVariableCard = memo(
    ({
        rowId,
        variable,
        editable,
        connectedSourceName,
        templateFormat,
        onValueChange,
    }: InputVariableCardProps) => {
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
        const {
            renderValue,
            conflicts,
            stashed: stashedPaths,
        } = useMemo(() => {
            if (skeleton === null)
                return {renderValue: value, conflicts: NO_CONFLICTS, stashed: NO_STASH}
            if (value === undefined || value === null || value === "") {
                return {renderValue: skeleton, conflicts: NO_CONFLICTS, stashed: NO_STASH}
            }
            if (!isPlainObject(value) || !isPlainObject(skeleton)) {
                return {renderValue: value, conflicts: NO_CONFLICTS, stashed: NO_STASH}
            }
            const {merged, conflicts, stashed} = buildSchemaStrictShape(skeleton, value, "")
            return {renderValue: merged, conflicts, stashed}
        }, [skeleton, value])

        // "Use prompt shape": each conflicting path takes the shape the prompt expects. The
        // plain value there is lost, because the card cannot tell which nested key it belongs to.
        const adoptPromptShape = useCallback(() => {
            if (!isPlainObject(value)) return
            onValueChange(
                name,
                conflicts.reduce(
                    (next, conflict) => setAtPath(next, conflict.key, conflict.expectedShape),
                    value,
                ),
            )
        }, [conflicts, name, onValueChange, value])

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
                    connectedSourceName={connectedSourceName}
                    mode={mode}
                    options={options}
                    onModeChange={setChosenMode}
                    editable={editable}
                    collapsed={collapsed}
                    onToggleCollapsed={() => setCollapsed((previous) => !previous)}
                />
                {collapsed ? null : (
                    <>
                        {editable && conflicts.length > 0 ? (
                            <ShapeConflictBanner conflicts={conflicts} onAdopt={adoptPromptShape} />
                        ) : null}
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
                        <StashedKeysToggle
                            key={stashedPaths.map((entry) => entry.path).join("|")}
                            variableName={name}
                            paths={stashedPaths}
                        />
                    </>
                )}
            </div>
        )
    },
)
InputVariableCard.displayName = "InputVariableCard"
