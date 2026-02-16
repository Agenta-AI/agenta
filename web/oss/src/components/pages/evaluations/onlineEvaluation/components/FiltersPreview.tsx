import {useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"

import {
    fieldConfigByOptionKey,
    type FieldConfig,
} from "@/oss/components/pages/observability/assets/filters/fieldAdapter"
import {getOperator} from "@/oss/components/pages/observability/assets/filters/operatorRegistry"
import getFilterColumns from "@/oss/components/pages/observability/assets/getFilterColumns"
import type {Filter, FilterConditions, FilterValue} from "@/oss/lib/Types"

import type {QueryFilteringPayload} from "../../../../../services/onlineEvaluations/api"
import {fromFilteringPayload} from "../assets/helpers"

import ReadOnlyBox from "./ReadOnlyBox"

const {Text} = Typography

interface FiltersPreviewProps {
    filtering?: QueryFilteringPayload | null
    filters?: Filter[]
    className?: string
    compact?: boolean
}

interface NormalizedFilter {
    id: string
    fieldLabel: string
    operatorLabel: string
    valueLabel: string
}

const formatValue = (value: FilterValue): string => {
    if (Array.isArray(value)) {
        const parts = value
            .map((entry) => formatValue(entry as FilterValue))
            .filter((part) => part && part !== "—")
        return parts.length ? parts.join(", ") : "—"
    }
    if (value && typeof value === "object") {
        if ("label" in value && (value as any).label) {
            return String((value as any).label)
        }
        if ("value" in value && (value as any).value) {
            return String((value as any).value)
        }
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined && v !== null && v !== "")
            .map(([key, val]) => `${key}: ${formatValue(val as FilterValue)}`)
        if (entries.length === 0) return "—"
        return entries.join(", ")
    }
    if (value === undefined || value === null || value === "") return "—"
    return String(value)
}

const buildNormalizedFilters = (
    filters: Filter[],
    fieldMap: Map<string, FieldConfig>,
): NormalizedFilter[] => {
    if (!filters.length) return []

    const lookupFieldConfig = (field?: string, key?: string) => {
        if (!field && !key) return undefined
        if (field && fieldMap.has(field)) return fieldMap.get(field)
        if (key && fieldMap.has(key)) return fieldMap.get(key)
        return undefined
    }

    return filters.map((filter, index) => {
        const cfg = lookupFieldConfig(filter.field, filter.key)
        const fieldLabel = cfg?.label ?? filter.key ?? filter.field ?? "-"

        const operator = filter.operator as FilterConditions
        let operatorLabel = operator || "is"
        if (cfg?.operatorOptions) {
            const match = cfg.operatorOptions.find((opt) => opt.value === operator)
            if (match?.label) {
                operatorLabel = match.label
            }
        } else {
            try {
                operatorLabel = getOperator(operator).label
            } catch {
                operatorLabel = operator || "is"
            }
        }

        let displayValue: FilterValue = filter.value
        if (cfg?.toUI) {
            try {
                displayValue = cfg.toUI(filter.value)
            } catch {
                displayValue = filter.value
            }
        }

        const valueLabel = formatValue(displayValue)

        return {
            id: `${filter.field || filter.key || "filter"}-${index}`,
            fieldLabel,
            operatorLabel,
            valueLabel,
        }
    })
}

const FiltersPreview = ({filtering, filters, className, compact}: FiltersPreviewProps) => {
    const columns = useMemo(() => getFilterColumns(), [])
    const fieldMap = useMemo(() => fieldConfigByOptionKey(columns), [columns])
    const normalizedFilters = useMemo(() => {
        const baseFilters = filters ?? fromFilteringPayload(filtering)
        return buildNormalizedFilters(baseFilters, fieldMap)
    }, [filters, filtering, fieldMap])

    const hasFilters = normalizedFilters.length > 0

    if (!hasFilters) {
        return (
            <Text type="secondary" className={className}>
                No filters
            </Text>
        )
    }

    if (compact) {
        return (
            <div className={clsx("flex flex-col gap-1 text-xs text-[#475467]", className)}>
                {normalizedFilters.map((item) => (
                    <div key={item.id} className="leading-snug">
                        <span className="font-medium text-[#1D2939]">{item.fieldLabel}</span>{" "}
                        <span className="text-[#98A2B3]">{item.operatorLabel}</span>{" "}
                        <span className="font-medium text-[#1D2939]">{item.valueLabel}</span>
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className={clsx("flex flex-col gap-1", className)}>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr,1fr,2fr] mb-1.5">
                <Text className="text-[11px] uppercase text-[#667085]">Field</Text>
                <Text className="text-[11px] uppercase text-[#667085]">Operator</Text>
                <Text className="text-[11px] uppercase text-[#667085]">Value</Text>
            </div>
            {normalizedFilters.map((item) => (
                <div key={item.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr,1fr,2fr]">
                    <ReadOnlyBox>{item.fieldLabel}</ReadOnlyBox>
                    <ReadOnlyBox>{item.operatorLabel}</ReadOnlyBox>
                    <ReadOnlyBox>{item.valueLabel}</ReadOnlyBox>
                </div>
            ))}
        </div>
    )
}

export default FiltersPreview
