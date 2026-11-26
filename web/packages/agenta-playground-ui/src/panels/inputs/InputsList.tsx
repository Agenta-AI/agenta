import {usePlaygroundInputsModel} from "../../hooks/usePlaygroundInputsModel"

import {InputVariableCard} from "./InputVariableCard"
import {UnusedColumnsToggle} from "./UnusedColumnsToggle"

export interface InputsListProps {
    /** The test case row. */
    rowId: string
    editable?: boolean
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
}

/**
 * The inputs of one test case: a card for each variable the prompt references, then a closed list
 * of the columns it does not reference.
 */
export const InputsList = ({rowId, editable = true, templateFormat}: InputsListProps) => {
    const {inputs, unreferencedColumns, connectedSourceName, setValue} = usePlaygroundInputsModel({
        rowId,
        downstreamKey: "",
    })
    if (inputs.length === 0 && unreferencedColumns.length === 0) return null
    return (
        <div className="flex min-w-0 flex-col gap-2">
            {inputs.map((variable) => (
                <InputVariableCard
                    key={variable.name}
                    rowId={rowId}
                    variable={variable}
                    editable={editable}
                    connectedSourceName={connectedSourceName}
                    templateFormat={templateFormat}
                    onValueChange={setValue}
                />
            ))}
            <UnusedColumnsToggle
                key={unreferencedColumns.map((column) => column.name).join("|")}
                rowId={rowId}
                columns={unreferencedColumns}
            />
        </div>
    )
}
