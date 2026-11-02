import type {FilterConditions} from "../core/types"

export const COLLECTION_MEMBERSHIP_OPS: {value: FilterConditions; label: string}[] = [
    {value: "in", label: "contains"},
    {value: "not_in", label: "does not contain"},
]

export const STRING_EQU_OPS: {value: FilterConditions; label: string}[] = [
    {value: "is", label: "is"},
    {value: "is_not", label: "is not"},
]

export const STRING_EQU_AND_CONTAINS_OPS: {value: FilterConditions; label: string}[] = [
    ...STRING_EQU_OPS,
    ...COLLECTION_MEMBERSHIP_OPS,
]

export const EXISTS_OPS: {value: FilterConditions; label: string}[] = [
    {value: "exists", label: "exists"},
    {value: "not_exists", label: "not exists"},
]

export const STRING_SEARCH_OPS: {value: FilterConditions; label: string}[] = [
    {value: "contains", label: "contains"},
    {value: "startswith", label: "starts with"},
    {value: "endswith", label: "ends with"},
    // {value: "matches", label: "matches"},
    // {value: "like", label: "like"},
]

export const STRING_COMPARISON_OPS: {value: FilterConditions; label: string}[] = [
    {value: "gt", label: ">"},
    {value: "lt", label: "<"},
    {value: "gte", label: ">="},
    {value: "lte", label: "<="},
]

export const NUM_OPS: {value: FilterConditions; label: string}[] = [
    {value: "eq", label: "="},
    {value: "neq", label: "!="},
    {value: "gt", label: ">"},
    {value: "lt", label: "<"},
    {value: "gte", label: ">="},
    {value: "lte", label: "<="},
]
