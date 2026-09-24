import {buildKitDefaultPermission, type BuildKitUiState} from "@agenta/entities/workflow"

import type {GatewayConnectionPermissions} from "../toolUtils"

import {PermissionDrawerBody, type PermissionPresetOption} from "./IntegrationPermissionDrawer"
import type {ItemDescriptor} from "./itemDescriptors"
import {ItemRow} from "./ItemRow"
import {PolicyGlyph} from "./PermissionGlyph"
import type {PermissionPolicyOption} from "./PermissionPolicySelect"

export interface BuildKitTool {
    key: string
    descriptor: ItemDescriptor
    readOnly?: boolean
    op?: string
}

export interface BuildKitSectionProps {
    state: BuildKitUiState
    onChange: (next: BuildKitUiState) => void
    disabled?: boolean
    tools: BuildKitTool[]
}

const presets: PermissionPresetOption[] = [
    {value: "allow_all", label: "Allow all", help: "Tools run without asking."},
    {value: "always_ask", label: "Ask all", help: "Ask before each tool runs."},
    {value: "ask_writes", label: "Allow reads", help: "Read-only tools run; write tools ask."},
    {value: "deny_all", label: "Deactivate", help: "Do not add the build kit to runs."},
    {
        value: "custom",
        label: "Custom",
        help: "Per-tool choices below.",
        disabled: true,
        separatorBefore: true,
    },
]
const toolOptions: PermissionPolicyOption[] = [
    {
        value: "allow",
        title: "Allow",
        help: "Run without asking.",
        icon: <PolicyGlyph value="allow" />,
    },
    {value: "ask", title: "Ask", help: "Ask before running.", icon: <PolicyGlyph value="ask" />},
    {
        value: "deny",
        title: "Deactivate",
        help: "Remove this tool from the run.",
        icon: <PolicyGlyph value="deny" />,
    },
]

export function BuildKitSection({state, onChange, disabled, tools}: BuildKitSectionProps) {
    const platform = tools.filter((tool) => tool.op)
    const permissions: GatewayConnectionPermissions = {
        default: "allow",
        tools: Object.fromEntries(
            platform.map((tool) => [
                tool.key,
                state.disabledOps.includes(tool.key)
                    ? "deny"
                    : (state.permissionOverrides?.[tool.key] ??
                      buildKitDefaultPermission(state, tool.readOnly === true)),
            ]),
        ),
    }
    const overrideCount = platform.filter(
        (tool) =>
            permissions.tools?.[tool.key] !==
            buildKitDefaultPermission(state, tool.readOnly === true),
    ).length
    const preset = !state.enabled
        ? "deny_all"
        : overrideCount
          ? "custom"
          : state.permissionDefault === "ask"
            ? "always_ask"
            : state.permissionDefault === "allow_reads"
              ? "ask_writes"
              : "allow_all"
    return (
        <div className="flex min-h-0 flex-col">
            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Playground build kit</span>
                <span className="text-xs text-colorTextDescription">
                    Tools the assistant uses here. Choices stay with this agent across commits, in
                    this browser. They do not change the published agent.
                </span>
            </div>
            <PermissionDrawerBody
                catalogKey="playground-build-kit"
                catalog={{
                    status: "ready",
                    complete: true,
                    tools: platform.map((tool) => ({
                        key: tool.key,
                        name: tool.descriptor.name,
                        description: tool.descriptor.description,
                        readOnly: tool.readOnly,
                    })),
                }}
                emptyLabel="No build kit tools available."
                permissions={permissions}
                onChangePermissions={() => undefined}
                onChangeToolPermission={(op, permission) => {
                    if (permission === "inherit") return
                    const overrides = {...state.permissionOverrides}
                    delete overrides[op]
                    if (permission !== "deny") overrides[op] = permission
                    onChange({
                        ...state,
                        disabledOps: [
                            ...state.disabledOps.filter((key) => key !== op),
                            ...(permission === "deny" ? [op] : []),
                        ],
                        permissionOverrides: overrides,
                    })
                }}
                presets={{
                    options: presets,
                    value: preset,
                    overrideCount,
                    onPick: (value) => {
                        if (value === "custom" || value === "follow_agent") return
                        onChange(
                            value === "deny_all"
                                ? {...state, enabled: false}
                                : {
                                      enabled: true,
                                      disabledOps: [],
                                      permissionOverrides: {},
                                      permissionDefault:
                                          value === "always_ask"
                                              ? "ask"
                                              : value === "ask_writes"
                                                ? "allow_reads"
                                                : "allow",
                                  },
                        )
                    },
                }}
                disabled={disabled}
                lockedTool={() => (state.enabled ? null : "The build kit is deactivated.")}
                toolOptions={toolOptions}
                writeLabel="Write"
                readOnlyLabel="Read-only"
                banner={
                    !state.enabled ? (
                        <span className="text-xs text-colorTextDescription">
                            The build kit is off. Its tools, skills and sandbox permissions will not
                            be added to the next run. The agent's own tools remain available.
                        </span>
                    ) : null
                }
                footNote={
                    <div className="flex flex-col gap-2">
                        <span className="text-xs text-colorTextDescription">
                            Included while the build kit is active
                        </span>
                        {tools
                            .filter((tool) => !tool.op)
                            .map((tool) => (
                                <ItemRow key={tool.key} descriptor={tool.descriptor} />
                            ))}
                    </div>
                }
            />
        </div>
    )
}
