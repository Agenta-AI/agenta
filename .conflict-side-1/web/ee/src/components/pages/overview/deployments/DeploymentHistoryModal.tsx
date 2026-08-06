import {useCallback, useEffect, useMemo, useState} from "react"

import {
    environmentMolecule,
    fetchEnvironmentRevisionsList,
    type EnvironmentRevision,
} from "@agenta/entities/environment"
import {useUserDisplayName} from "@agenta/entities/shared/user"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {CloseOutlined, MoreOutlined, SwapOutlined} from "@ant-design/icons"
import {ClockCounterClockwise, GearSix} from "@phosphor-icons/react"
import {Button, Dropdown, Modal, Space, Spin, Table, Tag, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"

import ContentSpinner from "@/oss/components/Spinner/ContentSpinner"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

import DeploymentRevertModal from "./DeploymentRevertModal"
import HistoryConfig from "./HistoryConfig"

const {Title} = Typography

// ============================================================================
// TYPES
// ============================================================================

interface AppReference {
    application?: {id?: string; slug?: string}
    application_variant?: {id?: string; slug?: string}
    application_revision?: {id?: string; slug?: string; version?: string}
}

/** Row type for the revisions table with app-specific extracted data */
interface RevisionRow {
    id: string
    version: number | null
    created_at: string | null
    message: string | null
    author: string | null
    created_by_id: string | null
    /** The app revision ID deployed in this env revision (for this specific app) */
    appRevisionId: string | null
    /** The variant slug for display */
    variantSlug: string | null
    /** Per-app deployment index (1 = oldest deployment, N = latest) */
    appDeploymentIndex: number
    /** The full revision data for revert */
    _envRevision: EnvironmentRevision
}

type DeploymentHistoryModalProps = {
    setIsHistoryModalOpen: (value: React.SetStateAction<boolean>) => void
    environmentId: string
    environmentName: string
    environmentVariantId: string | null
    /** The currently deployed app revision ID (for "current deployment" badge) */
    currentAppRevisionId: string | null
    appId: string
    appSlug: string | null
} & React.ComponentProps<typeof Modal>

// ============================================================================
// HELPERS
// ============================================================================

function extractAppRef(
    data: EnvironmentRevision["data"],
    appId: string,
    appSlug: string | null,
): {appRevisionId: string | null; variantSlug: string | null} {
    if (!data?.references) return {appRevisionId: null, variantSlug: null}
    const refs = data.references as Record<string, AppReference>
    for (const ref of Object.values(refs)) {
        if (
            (appId && ref?.application?.id === appId) ||
            (appSlug && ref?.application?.slug === appSlug)
        ) {
            return {
                appRevisionId: ref.application_revision?.id ?? null,
                variantSlug: ref.application_variant?.slug ?? null,
            }
        }
    }
    return {appRevisionId: null, variantSlug: null}
}

function getAppRevisionId(
    rev: EnvironmentRevision,
    appId: string,
    appSlug: string | null,
): string | null {
    if (!rev.data?.references) return null
    const refs = rev.data.references as Record<string, AppReference>
    for (const ref of Object.values(refs)) {
        if (appId && ref?.application?.id === appId) {
            return ref.application_revision?.id ?? null
        }
        if (appSlug && ref?.application?.slug === appSlug) {
            return ref.application_revision?.id ?? null
        }
    }
    return null
}

// ============================================================================
// AUTHOR CELL
// ============================================================================

const AuthorCell = ({authorId}: {authorId: string | null}) => {
    const name = useUserDisplayName(authorId ?? undefined)
    return <span>{name ?? "-"}</span>
}

// ============================================================================
// COMPONENT
// ============================================================================

const DeploymentHistoryModal = ({
    setIsHistoryModalOpen,
    environmentId,
    environmentName,
    environmentVariantId,
    currentAppRevisionId,
    appId,
    appSlug,
    ...props
}: DeploymentHistoryModalProps) => {
    const projectId = useAtomValue(projectIdAtom)

    const [revisionRows, setRevisionRows] = useState<RevisionRow[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [selectedRow, setSelectedRow] = useState<RevisionRow | null>(null)
    const [compareDeployment, setCompareDeployment] = useState(false)
    const [confirmModalOpen, setConfirmModalOpen] = useState(false)
    const [revertRow, setRevertRow] = useState<RevisionRow | null>(null)
    const [isReverting, setIsReverting] = useState(false)

    const revert = useSetAtom(environmentMolecule.actions.revert)

    // ========================================================================
    // FETCH REVISIONS
    // ========================================================================

    const fetchRevisions = useCallback(async () => {
        if (!projectId || !environmentId || !appId) return

        setIsLoading(true)
        try {
            const response = await fetchEnvironmentRevisionsList({
                projectId,
                environmentId,
                applicationId: appId,
            })

            // Filter: only revisions with version > 0 that contain this app
            const withAppRef = response.environment_revisions
                .filter((r) => (r.version ?? 0) > 0)
                .filter((r) => {
                    if (!r.data?.references) return false
                    const refs = r.data.references as Record<string, AppReference>
                    return Object.values(refs).some(
                        (ref) =>
                            ref?.application?.id === appId ||
                            (appSlug && ref?.application?.slug === appSlug),
                    )
                })

            // Dedup: only keep revisions where this app's deployment actually changed
            const deduped: typeof withAppRef = []
            for (let i = 0; i < withAppRef.length; i++) {
                const current = getAppRevisionId(withAppRef[i], appId, appSlug)
                const older =
                    i + 1 < withAppRef.length
                        ? getAppRevisionId(withAppRef[i + 1], appId, appSlug)
                        : null
                if (current !== older) {
                    deduped.push(withAppRef[i])
                }
            }

            // Build rows with per-app deployment indices (newest first)
            const total = deduped.length
            const rows: RevisionRow[] = deduped.map((r, i) => {
                const {appRevisionId, variantSlug} = extractAppRef(r.data, appId, appSlug)
                return {
                    id: r.id,
                    version: r.version ?? null,
                    created_at: r.created_at ?? null,
                    message: r.message ?? null,
                    author: r.author ?? null,
                    created_by_id: r.created_by_id ?? null,
                    appRevisionId,
                    variantSlug,
                    appDeploymentIndex: total - i,
                    _envRevision: r,
                }
            })

            setRevisionRows(rows)
            if (rows.length > 0) {
                setSelectedRow(rows[0])
            }
        } catch (error) {
            console.error("Failed to fetch deployment revisions:", error)
        } finally {
            setIsLoading(false)
        }
    }, [projectId, environmentId, appId, appSlug])

    useEffect(() => {
        if (props.open) {
            fetchRevisions()
        }
    }, [props.open, fetchRevisions])

    // ========================================================================
    // REVERT HANDLER
    // ========================================================================

    const handleRevert = useCallback(
        async (row: RevisionRow) => {
            if (!projectId || !environmentId || !environmentVariantId || row.version == null) return

            setIsReverting(true)
            try {
                const result = await revert({
                    projectId,
                    environmentId,
                    environmentVariantId,
                    targetRevisionVersion: row.version,
                    message: `Reverted to deployment v${row.appDeploymentIndex}`,
                })

                if (result?.success) {
                    message.success("Environment successfully reverted")
                    await fetchRevisions()
                } else {
                    message.error("Failed to revert deployment")
                }
            } catch (error) {
                console.error("Revert failed:", error)
                message.error("Failed to revert deployment")
            } finally {
                setIsReverting(false)
                setConfirmModalOpen(false)
            }
        },
        [projectId, environmentId, environmentVariantId, revert, fetchRevisions],
    )

    // ========================================================================
    // DERIVED STATE
    // ========================================================================

    const isShowingCurrentDeployment = useMemo(() => {
        return currentAppRevisionId != null && selectedRow?.appRevisionId === currentAppRevisionId
    }, [currentAppRevisionId, selectedRow])

    // The currently deployed revision's app revision ID (for "current" comparison badge)
    const currentDeploymentRow = useMemo(() => {
        return revisionRows.find((r) => r.appRevisionId === currentAppRevisionId) ?? null
    }, [revisionRows, currentAppRevisionId])

    // ========================================================================
    // TABLE COLUMNS
    // ========================================================================

    const columns: ColumnsType<RevisionRow> = useMemo(
        () => [
            {
                title: "Deployment",
                dataIndex: "appDeploymentIndex",
                key: "deployment",
                width: 100,
                render: (_, record) => (
                    <span>
                        v{record.appDeploymentIndex}
                        {record.appRevisionId === currentAppRevisionId && (
                            <Tag color="green" className="ml-2">
                                current
                            </Tag>
                        )}
                    </span>
                ),
            },
            {
                title: "Modified by",
                dataIndex: "author",
                key: "author",
                render: (_, record) => (
                    <AuthorCell authorId={record.created_by_id ?? record.author} />
                ),
            },
            {
                title: "Created on",
                dataIndex: "created_at",
                key: "created_at",
                render: (_, record) =>
                    record.created_at ? (
                        <span>{formatDay({date: record.created_at})}</span>
                    ) : (
                        <span>-</span>
                    ),
            },
            {
                title: <GearSix size={16} />,
                key: "actions",
                width: 61,
                fixed: "right",
                align: "center",
                render: (_, record) => (
                    <Dropdown
                        placement="bottomRight"
                        trigger={["hover"]}
                        menu={{
                            items: [
                                {
                                    key: "revert",
                                    label: "Revert",
                                    icon: <ClockCounterClockwise size={16} />,
                                    onClick: (event) => {
                                        event.domEvent.stopPropagation()
                                        setConfirmModalOpen(true)
                                        setRevertRow(record)
                                    },
                                    disabled: record.appRevisionId === currentAppRevisionId,
                                },
                                {
                                    key: "compare_to_current",
                                    label: "Compare to current",
                                    icon: <SwapOutlined />,
                                    onClick: (event) => {
                                        event.domEvent.stopPropagation()
                                        setSelectedRow(record)
                                        setCompareDeployment(true)
                                    },
                                    disabled: record.appRevisionId === currentAppRevisionId,
                                },
                            ],
                        }}
                    >
                        <Button
                            type="text"
                            icon={<MoreOutlined />}
                            size="small"
                            onClick={(event) => event.stopPropagation()}
                        />
                    </Dropdown>
                ),
            },
        ],
        [currentAppRevisionId],
    )

    // ========================================================================
    // RENDER
    // ========================================================================

    return (
        <>
            <Modal
                footer={null}
                closeIcon={null}
                destroyOnHidden
                title={
                    <Space className="[&_h1.ant-typography]:text-lg [&_h1.ant-typography]:font-medium [&_h1.ant-typography]:capitalize">
                        <Button
                            onClick={() => setIsHistoryModalOpen(false)}
                            type="text"
                            icon={<CloseOutlined />}
                        />
                        <Title>{environmentName} deployment history</Title>
                    </Space>
                }
                width={1200}
                centered
                {...props}
            >
                <div className="flex gap-6 py-6 h-[760px]">
                    {/* LEFT PANEL: Table or Current Deployment comparison */}
                    <div className="flex-1">
                        {compareDeployment && currentDeploymentRow?.appRevisionId ? (
                            <div className="flex-1 flex flex-col gap-6 overflow-y-auto h-full">
                                <Typography.Text className="text-base font-medium">
                                    Current Deployment
                                </Typography.Text>
                                <HistoryConfig
                                    revisionId={currentDeploymentRow.appRevisionId}
                                    showOriginal
                                />
                            </div>
                        ) : (
                            <Spin spinning={isLoading}>
                                <Table
                                    bordered
                                    className="ph-no-capture"
                                    columns={columns}
                                    rowKey="id"
                                    dataSource={revisionRows}
                                    scroll={{x: true}}
                                    onRow={(record, index) => ({
                                        onClick: () => setSelectedRow(record),
                                        style: {cursor: "pointer"},
                                    })}
                                    pagination={false}
                                />
                            </Spin>
                        )}
                    </div>

                    {/* RIGHT PANEL: Selected revision config */}
                    <div className="flex-1 flex flex-col gap-6 overflow-y-auto">
                        {!selectedRow ? (
                            <ContentSpinner />
                        ) : (
                            <>
                                <Space className="justify-between">
                                    <Typography.Text className="text-base font-medium">
                                        Deployment v{selectedRow.appDeploymentIndex}
                                    </Typography.Text>
                                    {isShowingCurrentDeployment ? (
                                        <Typography.Text>Current Deployment</Typography.Text>
                                    ) : (
                                        <Space>
                                            <Button
                                                size="small"
                                                className="flex items-center gap-2"
                                                onClick={() => {
                                                    setConfirmModalOpen(true)
                                                    setRevertRow(selectedRow)
                                                }}
                                            >
                                                <ClockCounterClockwise size={16} />
                                                Revert
                                            </Button>
                                            {compareDeployment ? (
                                                <Button
                                                    onClick={() => setCompareDeployment(false)}
                                                    icon={<CloseOutlined />}
                                                    type="primary"
                                                    size="small"
                                                >
                                                    Close comparison
                                                </Button>
                                            ) : (
                                                <Button
                                                    onClick={() => setCompareDeployment(true)}
                                                    icon={<SwapOutlined />}
                                                    size="small"
                                                >
                                                    Compare to current
                                                </Button>
                                            )}
                                        </Space>
                                    )}
                                </Space>

                                {selectedRow.variantSlug && (
                                    <div className="flex justify-between">
                                        <Typography.Text className="text-sm font-medium">
                                            Variant Deployed
                                        </Typography.Text>
                                        <Tag>{selectedRow.variantSlug}</Tag>
                                    </div>
                                )}

                                {selectedRow.message && (
                                    <Typography.Text type="secondary">
                                        {selectedRow.message}
                                    </Typography.Text>
                                )}

                                {selectedRow.appRevisionId ? (
                                    <HistoryConfig
                                        revisionId={selectedRow.appRevisionId}
                                        showOriginal
                                    />
                                ) : (
                                    <Typography.Text type="secondary" className="text-center mt-12">
                                        No configuration data available
                                    </Typography.Text>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </Modal>

            {revertRow && (
                <DeploymentRevertModal
                    open={confirmModalOpen}
                    onCancel={() => setConfirmModalOpen(false)}
                    onOk={() => handleRevert(revertRow)}
                    revisionVersion={revertRow.appDeploymentIndex}
                    environmentName={environmentName}
                    variantName={revertRow.variantSlug}
                    okButtonProps={{loading: isReverting}}
                />
            )}
        </>
    )
}

export default DeploymentHistoryModal
