import type {AnnotationMetricField} from "@agenta/annotation"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"

import {AnnotationField} from "./AnnotationField"
import {noteHeightKey} from "./queueViewStorage"

const outOfRange = (field: AnnotationMetricField) =>
    typeof field.value === "number" &&
    field.minimum !== undefined &&
    field.maximum !== undefined &&
    (field.value < field.minimum || field.value > field.maximum)

/**
 * The metrics one evaluator asks for, one field each, with an error line under a field: the
 * host's errors, and a number typed outside its range (the box clamps it when it loses focus).
 */
export const AnnotationEvaluatorSection = ({
    slug,
    fields,
    readOnly = false,
    fieldKeys = false,
    errors,
    onChange,
}: {
    slug: string
    fields: Record<string, AnnotationMetricField>
    readOnly?: boolean
    /** The queue's keys and focus on each field. */
    fieldKeys?: boolean
    errors?: Record<string, string>
    onChange: (slug: string, fieldKey: string, value: unknown) => void
}) => {
    const t = useT(queueScreensCatalog)
    const entries = Object.entries(fields)
    if (entries.length === 0) {
        return (
            <p className="m-0 py-1 text-body text-muted-foreground">
                No annotation fields available
            </p>
        )
    }
    const errorOf = (fieldKey: string, field: AnnotationMetricField) =>
        errors?.[fieldKey] ??
        (outOfRange(field)
            ? t("annotation.queueScreens.numberRange", {
                  min: field.minimum ?? "",
                  max: field.maximum ?? "",
              })
            : null)
    return (
        <div className="flex flex-col gap-4">
            {entries.map(([fieldKey, field]) => {
                const error = errorOf(fieldKey, field)
                return (
                    <div key={fieldKey} className="flex flex-col gap-1">
                        <AnnotationField
                            fieldKey={fieldKey}
                            field={field}
                            readOnly={readOnly}
                            fieldKeys={fieldKeys}
                            heightKey={noteHeightKey(slug, fieldKey)}
                            onChange={(value) => onChange(slug, fieldKey, value)}
                        />
                        {error ? (
                            <p role="alert" className="m-0 text-meta text-destructive">
                                {error}
                            </p>
                        ) : null}
                    </div>
                )
            })}
        </div>
    )
}
