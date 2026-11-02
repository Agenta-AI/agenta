import {useEffect, useMemo} from "react"

import {
    workflowAgentTemplateOverlayAtomFamily,
    workflowBuildKitUiStateAtomFamily,
    workflowBuildKitScopeAtomFamily,
    migrateBuildKitStateAtom,
    type BuildKitUiState,
} from "@agenta/entities/workflow"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {describeBuildKitEmbed, describeBuildKitPlatformTool} from "./buildKitDescriptors"
import {BuildKitSection, type BuildKitTool} from "./BuildKitSection"
import {asObj, staticEmbedSlug} from "./itemDescriptors"

function embedRow(entry: Record<string, unknown>, fallbackKey: string): BuildKitTool {
    const slug = staticEmbedSlug(entry)
    const refs = asObj(asObj(entry["@ag.embed"])?.["@ag.references"])
    const name = entry.name ?? asObj(refs?.workflow)?.name ?? asObj(refs?.workflow_revision)?.name
    return {
        key: slug ?? fallbackKey,
        descriptor: describeBuildKitEmbed(slug, typeof name === "string" ? name : undefined),
    }
}

export function useBuildKit({
    revisionId,
    disabled,
    stateOverride,
}: {
    revisionId: string | null
    disabled?: boolean
    stateOverride?: {value: BuildKitUiState; onChange: (next: BuildKitUiState) => void}
}) {
    const overlay = useAtomValue(
        useMemo(() => workflowAgentTemplateOverlayAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const [state, setState] = useAtom(
        useMemo(() => workflowBuildKitUiStateAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const scope = useAtomValue(
        useMemo(() => workflowBuildKitScopeAtomFamily(revisionId ?? ""), [revisionId]),
    )
    const migrate = useSetAtom(migrateBuildKitStateAtom)
    useEffect(() => {
        if (revisionId && scope) migrate(revisionId)
    }, [revisionId, scope, migrate])
    const value = stateOverride?.value ?? state
    const onChange = stateOverride?.onChange ?? setState
    const tools = useMemo(() => {
        const access = asObj(overlay?.op_access) ?? {}
        const rows: BuildKitTool[] = []
        for (const section of ["tools", "skills"]) {
            const entries = overlay?.[section]
            if (!Array.isArray(entries)) continue
            entries.forEach((entry, index) => {
                const tool = asObj(entry)
                if (!tool) return
                if (
                    section === "tools" &&
                    tool.type === "platform" &&
                    typeof tool.op === "string"
                ) {
                    rows.push({
                        key: tool.op,
                        op: tool.op,
                        readOnly: access[tool.op] === "read",
                        descriptor: describeBuildKitPlatformTool(tool.op),
                    })
                } else if ("@ag.embed" in tool) rows.push(embedRow(tool, `${section}-${index}`))
            })
        }
        return rows
    }, [overlay])
    const hasBuildKitOverlay = Boolean(overlay && (tools.length || overlay.sandbox))
    return {
        hasBuildKitOverlay,
        buildKitEnabled: value.enabled,
        buildKitSection: hasBuildKitOverlay ? (
            <BuildKitSection
                state={value}
                onChange={onChange}
                disabled={disabled || !scope}
                tools={tools}
            />
        ) : null,
    }
}
