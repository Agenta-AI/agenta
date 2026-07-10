/**
 * PiSettingsControl
 *
 * Pi-family harness settings that are authored through the agent template's existing `tools`
 * list. Built-ins persist as `{type: "builtin", name}` entries; an absent entry means Pi uses its
 * own defaults.
 */
import {memo, useCallback, useMemo} from "react"

import {Select} from "antd"

import {RailField, railInfoLabel} from "../../drawers/shared/RailField"

type PiBuiltinName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls"

interface BuiltinTool {
    type: "builtin"
    name: string
    [key: string]: unknown
}

export interface PiSettingsControlProps {
    /** The agent template's top-level `tools` value. */
    tools?: unknown[] | null
    /** Called with the next top-level `tools` value; undefined removes an empty tools field. */
    onChange: (tools: unknown[] | undefined) => void
    /** Disable the control. */
    disabled?: boolean
}

// Source of truth: Pi's session `tools` vocabulary (pi-coding-agent); the SDK forwards these
// names verbatim as `builtin_names`.
const PI_BUILTIN_OPTIONS: {value: PiBuiltinName; label: string}[] = [
    {value: "read", label: "Read"},
    {value: "bash", label: "Bash"},
    {value: "edit", label: "Edit"},
    {value: "write", label: "Write"},
    {value: "grep", label: "Grep"},
    {value: "find", label: "Find"},
    {value: "ls", label: "List files"},
]
const PI_BUILTIN_NAMES = new Set<string>(PI_BUILTIN_OPTIONS.map((option) => option.value))

function builtinNameOf(tool: unknown): string | null {
    if (typeof tool === "string") return tool
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return null
    const item = tool as Record<string, unknown>
    if (item.type === "builtin" && typeof item.name === "string") return item.name
    if (!("type" in item) && typeof item.name === "string") return item.name
    return null
}

function isKnownPiBuiltinName(name: string | null): name is PiBuiltinName {
    return !!name && PI_BUILTIN_NAMES.has(name)
}

function asBuiltinTool(name: PiBuiltinName, existing: unknown): BuiltinTool {
    if (
        existing &&
        typeof existing === "object" &&
        !Array.isArray(existing) &&
        (existing as Record<string, unknown>).type === "builtin"
    ) {
        return existing as BuiltinTool
    }
    return {type: "builtin", name}
}

export const PiSettingsControl = memo(function PiSettingsControl({
    tools,
    onChange,
    disabled = false,
}: PiSettingsControlProps) {
    const toolList = useMemo(() => (Array.isArray(tools) ? tools : []), [tools])

    const selected = useMemo(() => {
        const names = new Set(
            toolList.map((tool) => builtinNameOf(tool)).filter(isKnownPiBuiltinName),
        )
        return PI_BUILTIN_OPTIONS.map((option) => option.value).filter((name) => names.has(name))
    }, [toolList])

    const writeSelected = useCallback(
        (names: PiBuiltinName[]) => {
            const selectedNames = new Set(names)
            const existingByName = new Map<string, unknown>()
            const passthrough: unknown[] = []

            for (const tool of toolList) {
                const name = builtinNameOf(tool)
                if (isKnownPiBuiltinName(name)) {
                    existingByName.set(name, tool)
                } else {
                    passthrough.push(tool)
                }
            }

            const selectedBuiltins = PI_BUILTIN_OPTIONS.map((option) => option.value)
                .filter((name) => selectedNames.has(name))
                .map((name) => asBuiltinTool(name, existingByName.get(name)))
            const nextTools = [...passthrough, ...selectedBuiltins]
            onChange(nextTools.length ? nextTools : undefined)
        },
        [toolList, onChange],
    )

    return (
        <RailField
            label={railInfoLabel(
                "Built-in tools",
                "Optional Pi built-ins to author explicitly; empty leaves Pi's harness defaults.",
            )}
            align="center"
        >
            <Select<PiBuiltinName[]>
                mode="multiple"
                className="w-full"
                value={selected}
                onChange={(value) => writeSelected(value)}
                options={PI_BUILTIN_OPTIONS}
                placeholder="Pi defaults"
                disabled={disabled}
            />
        </RailField>
    )
})
