import React from "react"

import {WebhookProvider} from "@agenta/entities/webhook"
import type {Rule} from "antd/lib/form"

export type FieldComponent =
    | "input"
    | "input.password"
    | "select"
    | "multi-select"
    | "headers"
    | "auth"
    | "alert"

export interface FieldDescriptor {
    key: string
    label: string
    component: FieldComponent
    placeholder?: string
    required?: boolean
    disabled?: boolean | "editMode"
    initialValue?: unknown
    options?: {label: string; value: string}[]
    rules?: Rule[]
    extra?: React.ReactNode
    extraByValue?: Record<string, React.ReactNode>
    secret?: boolean
    visibleWhen?: {
        field: string
        value: unknown
    }
}

export interface WebhookSchemaEntry {
    provider: WebhookProvider
    label: string
    icon: React.ComponentType
    description: string
    subtitle: string
    fields: FieldDescriptor[]

    // Backend helpers / configurations
    headers?: Record<string, string>
    urlTemplates?: Record<string, string>
    payloadTemplates?: Record<string, Record<string, unknown>>
}
