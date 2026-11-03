import {Button, Field, InputNumber} from "@agenta/ui/ui"

import {
    CONCURRENCY_FIELDS,
    isDefaultConcurrency,
    type ConcurrencyField,
    type DraftConcurrency,
} from "./newEvaluationDraft"

/** The concurrency settings of an auto run. A cleared field is an error and blocks the start. */
export const AdvancedSettingsSection = ({
    concurrency,
    disabled,
    onChange,
    onReset,
}: {
    concurrency: DraftConcurrency
    disabled?: boolean
    onChange: (field: ConcurrencyField, value: number | null) => void
    onReset: () => void
}) => (
    <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
            <h3 className="m-0 text-sm font-semibold text-foreground">Concurrency</h3>
            {isDefaultConcurrency(concurrency) ? null : (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={onReset}
                >
                    Reset changes
                </Button>
            )}
        </div>
        {CONCURRENCY_FIELDS.map(({field, label, help}) => (
            <Field
                key={field}
                label={label}
                tooltip={help}
                error={concurrency[field] === null ? "This field is required" : undefined}
            >
                <InputNumber
                    min={0}
                    step={1}
                    value={concurrency[field]}
                    disabled={disabled}
                    onChange={(next) => onChange(field, next === null ? null : Math.round(next))}
                />
            </Field>
        ))}
    </div>
)
