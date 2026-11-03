import type {AnnotationMetricField} from "@agenta/annotation"

import {AnnotationField} from "./AnnotationField"

/** The metrics one evaluator asks for, one field each. */
export const AnnotationEvaluatorSection = ({
    slug,
    fields,
    onChange,
}: {
    slug: string
    fields: Record<string, AnnotationMetricField>
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
                <AnnotationField
                    key={fieldKey}
                    fieldKey={fieldKey}
                    field={field}
                    onChange={(value) => onChange(slug, fieldKey, value)}
                />
            ))}
        </div>
    )
}
