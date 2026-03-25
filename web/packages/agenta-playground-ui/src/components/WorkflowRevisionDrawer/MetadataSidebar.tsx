/**
 * MetadataSidebar
 *
 * Right sidebar showing entity metadata (date created, author, deployments, etc.)
 * Shown in collapsed mode only. Hidden for evaluator-create context (local-only entities).
 */
import {memo, useMemo} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {FormattedDate, cn, textColors} from "@agenta/ui"
import {Typography} from "antd"
import {useAtomValue} from "jotai"

import {useDrawerProviders} from "./DrawerContext"
import type {DrawerContext} from "./store"

const {Text} = Typography

interface MetadataSidebarProps {
    revisionId: string
    context: DrawerContext
}

/** Reusable metadata row: label above value */
function MetadataField({label, children}: {label: string; children: React.ReactNode}) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className={cn("text-xs font-medium", textColors.muted)}>{label}</span>
            <div>{children}</div>
        </div>
    )
}

const MetadataSidebar = memo(({revisionId, context}: MetadataSidebarProps) => {
    const workflowData = useAtomValue(
        useMemo(() => workflowMolecule.selectors.data(revisionId), [revisionId]),
    )
    const deployedIn = useAtomValue(environmentMolecule.atoms.revisionDeployment(revisionId))
    const {
        renderEnvironmentLabel,
        renderVariantDetails,
        renderPlaygroundButton,
        renderEvaluatorTypeLabel,
    } = useDrawerProviders()

    if (!workflowData) return null

    const isEvaluator = context === "evaluator-view" || context === "evaluator-create"

    return (
        <div className="w-[260px] h-full border-0 border-l border-solid border-zinc-2 shrink-0 overflow-y-auto flex flex-col">
            {/* Header */}
            <div className="px-4 pt-4 pb-3">
                <Text className={cn("text-sm font-semibold", textColors.secondary)}>Details</Text>
            </div>

            {/* Metadata fields */}
            <div className="px-4 pb-4 flex flex-col gap-5">
                {context === "deployment" && renderVariantDetails && (
                    <MetadataField label="Variant">
                        <div className="flex items-center justify-between gap-1">
                            {renderVariantDetails({
                                name: workflowData.name ?? "",
                                version: workflowData.version ?? 0,
                                variant: workflowData,
                            })}
                            {renderPlaygroundButton?.(revisionId)}
                        </div>
                    </MetadataField>
                )}

                {isEvaluator && renderEvaluatorTypeLabel && (
                    <MetadataField label="Type">
                        {renderEvaluatorTypeLabel(revisionId)}
                    </MetadataField>
                )}

                <MetadataField label="Date created">
                    <FormattedDate
                        date={workflowData.created_at}
                        className={cn(textColors.primary)}
                    />
                </MetadataField>

                <MetadataField label="Created by">
                    <UserAuthorLabel
                        userId={workflowData.created_by_id}
                        showPrefix={false}
                        showAvatar
                    />
                </MetadataField>

                {workflowData.message && (
                    <MetadataField label="Note">
                        <Text className="leading-relaxed">{workflowData.message}</Text>
                    </MetadataField>
                )}

                {deployedIn?.length > 0 && renderEnvironmentLabel && (
                    <MetadataField label="Deployment">
                        <div className="flex flex-wrap gap-1.5">
                            {deployedIn.map((env: {name: string}, idx: number) =>
                                renderEnvironmentLabel(env.name),
                            )}
                        </div>
                    </MetadataField>
                )}
            </div>
        </div>
    )
})

export default MetadataSidebar
