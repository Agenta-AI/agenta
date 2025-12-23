import {FilterConditions} from "@/oss/lib/Types"

import {FieldConfig} from "./fieldAdapter"
import {getOperator, valueShapeFor} from "./operatorRegistry"

export interface InputPlan {
    needsKey: boolean
    showValue: boolean
    valueAs: "text" | "select" | "tags" | "range" | "none"
    placeholders?: {key?: string; value?: string}
    valueOptions?: {label: string; value: string | number}[]
}

export const planInputs = (field: FieldConfig, opId: FilterConditions): InputPlan => {
    const op = getOperator(opId)
    const shape = valueShapeFor(opId, field.type)

    const needsKey = !!field.keyInput && field.keyInput.kind !== "none"
    const showValue = !op.hidesValue && field.valueInput?.kind !== "none"

    let valueAs: InputPlan["valueAs"] = "text"
    if (!showValue) valueAs = "none"
    else if (shape === "range") valueAs = "range"
    else if (shape === "list") valueAs = field.valueInput?.kind === "select" ? "tags" : "text"
    else if (shape === "single") valueAs = field.valueInput?.kind === "select" ? "select" : "text"

    return {
        needsKey,
        showValue,
        valueAs,
        placeholders: {
            key: field.keyInput?.placeholder,
            value: field.valueInput?.placeholder ?? (shape === "range" ? "[min, max]" : "Value"),
        },
        valueOptions: field.valueInput?.kind === "select" ? field.valueInput.options : undefined,
    }
}
