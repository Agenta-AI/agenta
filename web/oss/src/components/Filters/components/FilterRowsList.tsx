import React, {Dispatch, SetStateAction} from "react"
import {FilterItem, FilterMenuNode, RowValidation} from "../types"
import {FieldConfig} from "@/oss/components/pages/observability/assets/filters/fieldAdapter"
import {AnnotationFeedbackOption} from "../helpers/annotation"
import FilterRow from "./FilterRow"

interface FilterRowsListProps {
    filter: FilterItem[]
    getField: (uiKey?: string) => FieldConfig | undefined
    effectiveFieldForRow: (
        field: FieldConfig | undefined,
        item: FilterItem,
    ) => FieldConfig | undefined
    extractAnnotationValue: (raw: FilterItem["value"]) => any
    rowValidations: RowValidation[]
    hasAnnotationIndices: number[]
    annotationDisabledOptions: Set<string>
    annotationFeedbackOptions: AnnotationFeedbackOption[]
    onFilterChange: (args: {columnName: keyof FilterItem; value: any; idx: number}) => void
    onDeleteFilter: (index: number) => void
    activeFieldDropdown: number | null
    setActiveFieldDropdown: (index: number | null) => void
    handleFieldSelection: (uiValue: string, idx: number, selectedLabel?: string) => void
    annotationEvaluatorOptions: {label: string; value: string}[]
    keySearchTerms: Record<number, string>
    setKeySearchTerms: Dispatch<SetStateAction<Record<number, string>>>
    columns: FilterMenuNode[]
}

const FilterRowsList = (props: FilterRowsListProps) => {
    const {filter, onFilterChange} = props

    return filter.map((item, idx) => (
        <FilterRow
            key={idx}
            {...props}
            item={item}
            idx={idx}
            onFilterChangeIdx={(columnName, value) => onFilterChange({columnName, value, idx})}
        />
    ))
}

export default FilterRowsList
