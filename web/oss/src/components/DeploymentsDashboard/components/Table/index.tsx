import {useCallback, useMemo} from "react"

import {CloudArrowUp} from "@phosphor-icons/react"
import {Table, Typography} from "antd"
import Image from "next/image"
import {useRouter} from "next/router"

import EmptyComponent from "@/oss/components/EmptyComponent"
import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {DeploymentRevisions} from "@/oss/lib/Types"

import {DeploymentRevisionWithVariant} from "../.."

import {getColumns} from "./assets/getDeploymentColumns"

interface DeploymentTableProps {
    handleFetchRevisionConfig: (revisionId: string) => Promise<void>
    setSelectedRevisionRow: React.Dispatch<
        React.SetStateAction<DeploymentRevisionWithVariant | undefined>
    >
    revisions: DeploymentRevisionWithVariant[]
    setIsRevertModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    setSelectedVariantRevisionIdToRevert: React.Dispatch<React.SetStateAction<string>>
    envRevisions: DeploymentRevisions | undefined
    setIsSelectDeployVariantModalOpen: (value: React.SetStateAction<boolean>) => void
    setQueryVariant: (val: string) => void
}

const DeploymentTable = ({
    handleFetchRevisionConfig,
    setSelectedRevisionRow,
    setIsRevertModalOpen,
    revisions,
    setSelectedVariantRevisionIdToRevert,
    envRevisions,
    setIsSelectDeployVariantModalOpen,
}: DeploymentTableProps) => {
    const [_, setQueryRevision] = useQueryParam("revisions")
    const router = useRouter()
    const appId = useAppId()

    const handleAssignRevisionId = useCallback((record: DeploymentRevisionWithVariant) => {
        setQueryRevision(
            JSON.stringify([record.deployed_app_variant_revision ?? record.variant.id]),
        )
    }, [])

    const initialColumns = useMemo(
        () =>
            getColumns({
                handleFetchRevisionConfig,
                setSelectedRevisionRow,
                setIsRevertModalOpen,
                setSelectedVariantRevisionIdToRevert,
                handleAssignRevisionId,
                envRevisions,
                router,
                appId,
            }),
        [
            handleFetchRevisionConfig,
            setSelectedRevisionRow,
            setIsRevertModalOpen,
            setSelectedVariantRevisionIdToRevert,
            revisions,
            envRevisions,
            router,
            appId,
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
            onRow={(record) => ({
                className: "variant-table-row",
                style: {cursor: "pointer"},
                onClick: () => {
                    handleFetchRevisionConfig(record.id)
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
