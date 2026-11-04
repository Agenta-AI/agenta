import type {AnnotationMetricField} from "@agenta/annotation"

import {AnnotationField} from "./AnnotationField"

/** The metrics one evaluator asks for, one field each, with an error line under a field. */
export const AnnotationEvaluatorSection = ({
    slug,
    fields,
    errors,
    onChange,
}: {
    slug: string
    fields: Record<string, AnnotationMetricField>
    errors?: Record<string, string>
    onChange: (slug: string, fieldKey: string, value: unknown) => void
}) => {
    const entries = Object.entries(fields)
    if (entries.length === 0) {
        return (
            <p className="m-0 py-1 text-sm text-muted-foreground">No annotation fields available</p>
        )
    }
    return (
        <div className="flex flex-col gap-4">
            {entries.map(([fieldKey, field]) => (
                <div key={fieldKey} className="flex flex-col gap-1">
                    <AnnotationField
                        fieldKey={fieldKey}
                        field={field}
                        onChange={(value) => onChange(slug, fieldKey, value)}
                    />
                    {errors?.[fieldKey] ? (
                        <p role="alert" className="m-0 text-xs text-destructive">
                            {errors[fieldKey]}
                        </p>
                    ) : null}
                </div>
            ))}
        </div>
    )
}
