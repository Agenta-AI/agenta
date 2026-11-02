import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {AnnotationField} from "../../../mobile/src/features/annotations/AnnotationField"
import type {AnnotationMetricField} from "../../fixtures/annotationSession"

/** One field with its own value, so the controls can be clicked through. */
const Frame = ({
    fieldKey,
    field,
    readOnly,
}: {
    fieldKey: string
    field: AnnotationMetricField
    readOnly?: boolean
}) => {
    const [value, setValue] = useState<unknown>(field.value)
    return (
        <div className="w-[min(400px,calc(100vw-32px))] rounded-lg border border-solid border-border bg-background p-3">
            <AnnotationField
                fieldKey={fieldKey}
                field={{...field, value}}
                readOnly={readOnly}
                onChange={setValue}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/AnnotationQueues/AnnotationField",
    component: Frame,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "One annotation metric from web/mobile, drawn by its schema type. Every field has a clear button; an empty ranged number shows no slider thumb.",
            },
        },
    },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

export const Boolean: Story = {
    args: {fieldKey: "friendly", field: {value: null, type: "boolean"}},
    play: async ({canvasElement}) => {
        const screen = within(canvasElement)
        await userEvent.click(screen.getByRole("radio", {name: "True"}))
        await expect(screen.getByRole("button", {name: "Clear value"})).toBeEnabled()
    },
}

export const NumberRange: Story = {
    args: {fieldKey: "score", field: {value: null, type: "integer", minimum: 1, maximum: 5}},
    play: async ({canvasElement}) => {
        // Empty: the slider's thumb and filled track are hidden.
        await expect(canvasElement.querySelector("[data-slot=slider][data-empty]")).not.toBeNull()
    },
}

export const NumberFree: Story = {
    args: {fieldKey: "latency_ms", field: {value: 320, type: "number"}},
}

export const Text: Story = {
    args: {fieldKey: "comment", field: {value: null, type: "string"}},
}

export const SingleSelect: Story = {
    args: {
        fieldKey: "verdict",
        field: {value: null, type: ["string", "null"], enum: ["correct", "partly", null]},
    },
}

export const MultiSelect: Story = {
    args: {
        fieldKey: "issues",
        field: {
            value: ["tone"],
            type: "array",
            items: {type: "string", enum: ["tone", "accuracy", "length"]},
        },
    },
}

export const ReadOnly: Story = {
    args: {
        fieldKey: "score",
        readOnly: true,
        field: {value: 4, type: "integer", minimum: 1, maximum: 5},
    },
}
