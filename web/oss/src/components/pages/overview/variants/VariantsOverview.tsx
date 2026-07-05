import {useCallback, useMemo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Rocket} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"

import {openDeployVariantModalAtom} from "@/oss/components/Playground/Components/Modals/DeployVariantModal/store/deployVariantModalStore"
import type {RegistryRevisionRow} from "@/oss/components/VariantsComponents/store/registryStore"
import type {RegistryColumnActions} from "@/oss/components/VariantsComponents/Table/assets/registryColumns"
import RegistryTable from "@/oss/components/VariantsComponents/Table/RegistryTable"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQuery} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

const VariantsOverview = () => {
    const [, updateQuery] = useQuery()
    const {appURL} = useURL()
    const {goToPlayground} = usePlaygroundNavigation()
    const openDeployVariantModal = useSetAtom(openDeployVariantModalAtom)
    // Evaluator workflows aren't deployed — hide the row "Deploy" action.
    const isCurrentWorkflowEvaluator =
        useAtomValue(currentWorkflowContextAtom).workflowKind === "evaluator"

    const handleRowClick = useCallback(
        (record: RegistryRevisionRow) => {
            updateQuery({
                revisionId: record.revisionId,
                drawerType: "variant",
            })
        },
        [updateQuery],
    )

    const handleOpenInPlayground = useCallback(
        (record: RegistryRevisionRow) => {
            if (record.revisionId) {
                goToPlayground(record.revisionId)
            } else {
                goToPlayground()
            }
        },
        [goToPlayground],
    )

    const handleDeploy = useCallback(
        (record: RegistryRevisionRow) => {
            openDeployVariantModal({
                parentVariantId: null,
                revisionId: record.revisionId,
                variantName: record.variantName,
                revision: record.version ?? 0,
            })
        },
        [openDeployVariantModal],
    )

    const columnActions = useMemo<RegistryColumnActions>(
        () => ({
            handleOpenDetails: handleRowClick,
            handleOpenInPlayground,
            handleDeploy,
        }),
        [handleRowClick, handleOpenInPlayground, handleDeploy],
    )

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <h3 className="!m-0">Recent Prompts</h3>

                <Button onClick={() => goToPlayground()}>
                    {<Rocket size={14} className="mt-[3px]" />}
                    Playground
                </Button>
            </div>

            <RegistryTable
                onRowClick={handleRowClick}
                actions={columnActions}
                hideDeployActions={isCurrentWorkflowEvaluator}
                scopeId="overview-recent"
                pageSize={5}
                columnVisibilityStorageKey="agenta:overview-registry:column-visibility"
            />

            <div className="flex justify-end">
                <Link href={`${appURL}/variants`} prefetch className="underline">
                    View all prompts →
                </Link>
            </div>
        </div>
    )
}

export default VariantsOverview
