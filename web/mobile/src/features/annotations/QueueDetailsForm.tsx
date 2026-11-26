import type {FormEvent} from "react"

import {Button, Field, Input, LoadingButton, Textarea} from "@agenta/ui/ui"

import {useQueueDetailsForm} from "./useQueueDetailsForm"

/**
 * The editable Name and Description of the Configuration tab, as in /w. Reset and Save show
 * once a value differs from the saved one.
 */
export const QueueDetailsForm = ({
    queueId,
    savedName,
    savedDescription,
}: {
    queueId: string
    savedName: string
    savedDescription: string
}) => {
    const form = useQueueDetailsForm({queueId, savedName, savedDescription})

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault()
        void form.save()
    }

    return (
        <form
            noValidate
            onSubmit={handleSubmit}
            aria-label="Queue details"
            className="flex flex-col gap-3"
        >
            <Field label="Name" size="sm" gap="sm" error={form.nameError}>
                <Input
                    value={form.name}
                    maxLength={100}
                    placeholder="Enter name"
                    disabled={form.isSaving}
                    onChange={(event) => form.update({name: event.target.value})}
                />
            </Field>
            <Field label="Description" size="sm" gap="sm">
                <Textarea
                    rows={3}
                    value={form.description}
                    placeholder="Enter description"
                    disabled={form.isSaving}
                    onChange={(event) => form.update({description: event.target.value})}
                />
            </Field>
            {form.error ? (
                <p role="alert" className="m-0 text-sm text-error">
                    {form.error}
                </p>
            ) : null}
            {form.changed ? (
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={form.isSaving}
                        onClick={form.reset}
                    >
                        Reset
                    </Button>
                    <LoadingButton
                        type="submit"
                        loading={form.isSaving}
                        disabled={Boolean(form.nameError)}
                    >
                        Save
                    </LoadingButton>
                </div>
            ) : null}
        </form>
    )
}
