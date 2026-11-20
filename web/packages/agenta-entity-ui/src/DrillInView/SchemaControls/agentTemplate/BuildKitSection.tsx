import {buildKitDefaultPermission, type BuildKitUiState} from "@agenta/entities/workflow"
import {createT, useT, type CatalogKey} from "@agenta/i18n"
import buildKitCatalog from "@agenta/i18n/catalogs/entityUi.buildKit"

import type {GatewayConnectionPermissions} from "../toolUtils"

import {PermissionDrawerBody, type PermissionPresetOption} from "./IntegrationPermissionList"
import type {ItemDescriptor} from "./itemDescriptors"
import {ItemRow} from "./ItemRow"
import {PolicyGlyph} from "./PermissionGlyph"
import type {PermissionPolicyOption} from "./PermissionPolicySelect"

const tNow = createT(buildKitCatalog)

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
    /** A read-only view (a phone): the permissions show as text. */
    readOnly?: boolean
    tools: BuildKitTool[]
}

type BuildKitKey = CatalogKey<typeof buildKitCatalog>

/** A preset whose texts read the active language each time they are read. */
const preset = (
    value: PermissionPresetOption["value"],
    label: BuildKitKey,
    help: BuildKitKey,
    extra: Partial<PermissionPresetOption> = {},
): PermissionPresetOption => ({
    value,
    get label() {
        return tNow(label)
    },
    get help() {
        return tNow(help)
    },
    ...extra,
})

const presets: PermissionPresetOption[] = [
    preset("allow_all", "entityUi.buildKit.presetAllowAll", "entityUi.buildKit.presetAllowAllHelp"),
    preset("always_ask", "entityUi.buildKit.presetAskAll", "entityUi.buildKit.presetAskAllHelp"),
    preset(
        "ask_writes",
        "entityUi.buildKit.presetAllowReads",
        "entityUi.buildKit.presetAllowReadsHelp",
    ),
    preset(
        "deny_all",
        "entityUi.buildKit.presetDeactivate",
        "entityUi.buildKit.presetDeactivateKitHelp",
    ),
    preset("custom", "entityUi.buildKit.presetCustom", "entityUi.buildKit.presetCustomHelp", {
        disabled: true,
        separatorBefore: true,
    }),
]

/** A per-tool option whose texts read the active language each time they are read. */
const toolOption = (
    value: "allow" | "ask" | "deny",
    title: BuildKitKey,
    help: BuildKitKey,
): PermissionPolicyOption => ({
    value,
    get title() {
        return tNow(title)
    },
    get help() {
        return tNow(help)
    },
    icon: <PolicyGlyph value={value} />,
})

export const buildKitToolOptions: PermissionPolicyOption[] = [
    toolOption("allow", "entityUi.buildKit.toolAllow", "entityUi.buildKit.toolAllowHelp"),
    toolOption("ask", "entityUi.buildKit.toolAsk", "entityUi.buildKit.toolAskHelp"),
    toolOption("deny", "entityUi.buildKit.toolDeactivate", "entityUi.buildKit.toolDeactivateHelp"),
]

export function BuildKitSection({
    state,
    onChange,
    disabled,
    readOnly,
    tools,
}: BuildKitSectionProps) {
    const t = useT(buildKitCatalog)
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
                <span className="text-sm font-medium">
                    {t("entityUi.buildKit.playgroundBuildKit")}
                </span>
                <span className="text-xs text-colorTextDescription">
                    {t("entityUi.buildKit.playgroundBuildKitHint")}
                </span>
            </div>
            <PermissionDrawerBody
                flush
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
                emptyLabel={t("entityUi.buildKit.noBuildKitTools")}
                permissions={state.enabled ? permissions : {default: "deny", tools: {}}}
                onChangePermissions={() => undefined}
                onChangeToolPermission={(op, permission) => {
                    if (permission === "inherit" || permission === "allow_reads") return
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
                valuesAsText={readOnly}
                lockedTool={() =>
                    state.enabled ? null : t("entityUi.buildKit.buildKitDeactivated")
                }
                toolOptions={buildKitToolOptions}
                writeLabel={t("entityUi.buildKit.writeGroup")}
                readOnlyLabel={t("entityUi.buildKit.readOnlyGroup")}
                banner={
                    !state.enabled ? (
                        <span className="text-xs text-colorTextDescription">
                            {t("entityUi.buildKit.buildKitOff")}
                        </span>
                    ) : null
                }
                footNote={
                    <div className="flex flex-col gap-2">
                        <span className="text-xs text-colorTextDescription">
                            {t("entityUi.buildKit.includedWhileActive")}
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
