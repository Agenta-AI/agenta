import {useCallback, useMemo} from "react"

import {CloudArrowUp} from "@phosphor-icons/react"
import {Table, Typography} from "antd"
import {useAtomValue} from "jotai"
import Image from "next/image"

import EmptyComponent from "@/oss/components/Placeholders/EmptyComponent"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQuery} from "@/oss/hooks/useQuery"
import {DeploymentRevisions} from "@/oss/lib/Types"
import {variantsLoadingAtom} from "@/oss/state/variant/atoms/fetcher"

import {DeploymentRevisionWithVariant} from "../../atoms"

import {getColumns, type OnOpenUseApiPayload} from "./assets/getDeploymentColumns"

interface DeploymentTableProps {
    setSelectedRevisionRow: React.Dispatch<
        React.SetStateAction<DeploymentRevisionWithVariant | undefined>
    >
    revisions: DeploymentRevisionWithVariant[]
    setIsRevertModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    setSelectedVariantRevisionIdToRevert: React.Dispatch<React.SetStateAction<string>>
    envRevisions: DeploymentRevisions | undefined
    setIsSelectDeployVariantModalOpen: (value: React.SetStateAction<boolean>) => void
    onOpenUseApi: (payload?: OnOpenUseApiPayload) => void
    isLoading?: boolean
}

const DeploymentTable = ({
    revisions,
    envRevisions,
    isLoading,
    setSelectedRevisionRow,
    setIsRevertModalOpen,
    setSelectedVariantRevisionIdToRevert,
    setIsSelectDeployVariantModalOpen,
    onOpenUseApi,
}: DeploymentTableProps) => {
    const [, updateQuery] = useQuery()
    const {goToPlayground} = usePlaygroundNavigation()
    const variantsLoading = useAtomValue(variantsLoadingAtom)

    const handleAssignRevisionId = useCallback(
        (record: DeploymentRevisionWithVariant) => {
            const targetId = record.deployed_app_variant_revision ?? record.variant.id
            if (targetId) {
                updateQuery({revisionId: targetId, drawerType: "deployment"})
            } else {
                updateQuery({revisionId: undefined, drawerType: undefined})
            }
        },
        [updateQuery],
    )

    const initialColumns = useMemo(
        () =>
            getColumns({
                setSelectedRevisionRow,
                setIsRevertModalOpen,
                setSelectedVariantRevisionIdToRevert,
                handleAssignRevisionId,
                envRevisions,
                onOpenInPlayground: goToPlayground,
                onOpenUseApi,
                isVariantLoading: isLoading || variantsLoading,
            }),
        [
            setSelectedRevisionRow,
            setIsRevertModalOpen,
            setSelectedVariantRevisionIdToRevert,
            revisions,
            envRevisions,
            goToPlayground,
            onOpenUseApi,
            isLoading,
            variantsLoading,
        ],
    )

    return (
        <Table
            className="ph-no-capture"
            rowKey="id"
            columns={initialColumns}
            dataSource={revisions}
            scroll={{x: "max-content"}}
            bordered
            pagination={{
                pageSize: 15,
                showSizeChanger: true,
            }}
            loading={isLoading}
            onRow={(record) => ({
                className: "variant-table-row",
                style: {cursor: "pointer"},
                onClick: () => {
                    setSelectedRevisionRow(record)
                    setSelectedVariantRevisionIdToRevert(record.deployed_app_variant_revision)
                    handleAssignRevisionId(record)
                },
            })}
            locale={{
                emptyText: (
                    <div className="py-16">
                        <EmptyComponent
                            image={
                                <Image
                                    src="/assets/not-found.png"
                                    alt="not-found"
                                    width={240}
                                    height={210}
                                />
                            }
                            description={
                                <Typography.Text className="font-medium text-base">
                                    No Deployments
                                </Typography.Text>
                            }
                            primaryCta={{
                                text: "Deploy variant",
                                onClick: () => setIsSelectDeployVariantModalOpen(true),
                                icon: <CloudArrowUp size={14} />,
                                type: "default",
                                size: "middle",
                            }}
                        />
                    </div>
                ),
            }}
        />
    )
}

export default DeploymentTable
