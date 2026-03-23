import {useMemo} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {workflowRevisionsListDataAtomFamily} from "@agenta/entities/workflow"
import {PencilSimpleLine} from "@phosphor-icons/react"
import {Typography} from "antd"
import {atom, useAtomValue} from "jotai"

import {EnvironmentStatus} from "@agenta/entity-ui"

interface VariantGroupTitleProps {
    parent: {
        id?: string
        variantId?: string
        isLocalDraftGroup?: boolean
        variantName?: string
        name?: string
    }
    defaultNode: React.ReactNode
}

const VariantGroupTitle = ({parent, defaultNode}: VariantGroupTitleProps) => {
    if (parent.isLocalDraftGroup) {
        return (
            <div className="flex items-center justify-between pr-0 grow">
                <div className="flex items-center gap-1.5">
                    <PencilSimpleLine size={14} className="text-[#9254de]" />
                    <Typography.Text className="font-medium text-[#9254de]">
                        {defaultNode ?? parent.variantName ?? parent.name ?? "Local Drafts"}
                    </Typography.Text>
                </div>
            </div>
        )
    }

    const parentId = parent.variantId ?? parent.id ?? ""

    return (
        <RegularVariantGroupTitle
            parentId={parentId}
            displayName={parent.variantName ?? parent.name}
            defaultNode={defaultNode}
        />
    )
}

/**
 * Variant group header with deployment badges.
 *
 * Aggregates deployment info across all revisions of this variant.
 * Separated to avoid conditional hook calls in the parent component.
 */
const RegularVariantGroupTitle = ({
    parentId,
    displayName,
    defaultNode,
}: {
    parentId: string
    displayName?: string
    defaultNode: React.ReactNode
}) => {
    const deploymentAtom = useMemo(
        () =>
            atom((get) => {
                if (!parentId) return []
                const revisions = get(workflowRevisionsListDataAtomFamily(parentId))

                const allDeployments: {name: string}[] = []
                const seenEnvNames = new Set<string>()

                for (const rev of revisions) {
                    const envs = get(environmentMolecule.atoms.revisionDeployment(rev.id)) || []
                    for (const env of envs as {name: string}[]) {
                        if (!seenEnvNames.has(env.name)) {
                            seenEnvNames.add(env.name)
                            allDeployments.push(env)
                        }
                    }
                }
                return allDeployments
            }),
        [parentId],
    )

    const deployedIn = useAtomValue(deploymentAtom)

    return (
        <div className="flex items-center justify-between pr-0 grow">
            <Typography.Text ellipsis={{tooltip: displayName}}>
                {defaultNode ?? displayName}
            </Typography.Text>
            <EnvironmentStatus className="mr-2" variant={{deployedIn}} />
        </div>
    )
}

export default VariantGroupTitle
