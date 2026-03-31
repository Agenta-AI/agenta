import {FilterConditions} from "@/oss/lib/Types"

export type ScalarType = "string" | "number" | "exists"
export type ValueShape = "none" | "single" | "list" | "range"

export interface OperatorDef {
    id: FilterConditions
    label: string
    forTypes: ScalarType[]
    valueShape: ValueShape
    hidesValue?: boolean
}

export const OPERATORS: OperatorDef[] = [
    // string search
    {id: "contains", label: "contains", forTypes: ["string"], valueShape: "single"},
    {id: "startswith", label: "starts with", forTypes: ["string"], valueShape: "single"},
    {id: "endswith", label: "ends with", forTypes: ["string"], valueShape: "single"},

    // string equality / membership (shape is adjusted by valueShapeFor below)
    {id: "is", label: "is", forTypes: ["string", "exists"], valueShape: "single"},
    {id: "is_not", label: "is not", forTypes: ["string", "exists"], valueShape: "single"},

    // existence
    {id: "exists", label: "exists", forTypes: ["exists"], valueShape: "none", hidesValue: true},
    {
        id: "not_exists",
        label: "not exists",
        forTypes: ["exists"],
        valueShape: "none",
        hidesValue: true,
    },

    // list membership (explicit)
    {id: "in", label: "in", forTypes: ["string", "exists"], valueShape: "list"},
    {id: "not_in", label: "not in", forTypes: ["string", "exists"], valueShape: "list"},

    // numeric
    {id: "eq", label: "=", forTypes: ["number"], valueShape: "single"},
    {id: "neq", label: "!=", forTypes: ["number"], valueShape: "single"},
    {id: "gt", label: ">", forTypes: ["number", "string"], valueShape: "single"},
    {id: "lt", label: "<", forTypes: ["number", "string"], valueShape: "single"},
    {id: "gte", label: ">=", forTypes: ["number", "string"], valueShape: "single"},
    {id: "lte", label: "<=", forTypes: ["number", "string"], valueShape: "single"},
]

export const getOperator = (id: FilterConditions) => OPERATORS.find((o) => o.id === id)!

export const getOperatorsForType = (t: ScalarType) =>
    OPERATORS.filter((o) => o.forTypes.includes(t))

/**
 * Resolve the *effective* value shape of an operator for a given field type.
 * - "is"/"is_not": single for string, list for exists (select/tag style)
 * - everything else: as declared
 */
export const valueShapeFor = (opId: FilterConditions, t: ScalarType): ValueShape => {
    if (opId === "is" || opId === "is_not") {
        return t === "exists" ? "list" : "single"
    }
    return getOperator(opId).valueShape
}
