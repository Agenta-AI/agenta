/** The agent's sandbox (`sandbox.kind`) and the sandboxes this deployment offers. */
import {useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {getEnabledSandboxProviders} from "@agenta/shared/api"

import {getEnumOptions} from "../EnumSelectControl"

const asObject = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}

export const useSandboxChoice = (
    schema: SchemaProperty | null | undefined,
    config: Record<string, unknown>,
) => {
    const sandboxProps = (asObject(asObject(schema?.properties).sandbox).properties ??
        {}) as Record<string, SchemaProperty>
    const sandbox = asObject(config.sandbox)
    // The configuration's value, edits included (not the saved version's).
    const sandboxKind = typeof sandbox.kind === "string" ? sandbox.kind : null
    // Where Daytona is enabled, `inprocess` is not a choice of its own. For either value the runner
    // runs Pi in-process and every other harness on Daytona (`routeSandboxForHarness`), so the
    // picker offers Daytona alone and shows an agent saved with `inprocess` as Daytona, without
    // rewriting it. A deployment without Daytona keeps `inprocess` as it is.
    const daytonaEnabled = getEnabledSandboxProviders().includes("daytona")
    const shownSandboxKind = daytonaEnabled && sandboxKind === "inprocess" ? "daytona" : sandboxKind
    const sandboxOptions = useMemo(() => {
        const enabled = new Set(getEnabledSandboxProviders())
        return getEnumOptions(sandboxProps.kind).filter(
            (o) => enabled.has(o.value) && !(daytonaEnabled && o.value === "inprocess"),
        )
    }, [sandboxProps.kind, daytonaEnabled])
    return {
        sandboxProps,
        sandbox,
        sandboxKind,
        shownSandboxKind,
        sandboxOptions,
        /** Execution shows only when there is more than one sandbox to pick. */
        hasExecutionGroup: sandboxOptions.length > 1,
    }
}
