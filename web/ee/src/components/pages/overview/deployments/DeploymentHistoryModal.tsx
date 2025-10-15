// @ts-nocheck
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {CloseOutlined, MoreOutlined, SwapOutlined} from "@ant-design/icons"
import {ClockCounterClockwise, GearSix} from "@phosphor-icons/react"
import {Button, Dropdown, message, Modal, Space, Spin, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import VariantPopover from "@/oss/components/pages/overview/variants/VariantPopover"
import ContentSpinner from "@/oss/components/Spinner/ContentSpinner"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {Environment, JSSTheme, Variant} from "@/oss/lib/Types"
import {DeploymentRevision, DeploymentRevisionConfig, DeploymentRevisions} from "@/oss/lib/types_ee"

import DeploymentRevertModal from "./DeploymentRevertModal"
import HistoryConfig from "./HistoryConfig"

type DeploymentHistoryModalProps = {
    setIsHistoryModalOpen: (value: React.SetStateAction<boolean>) => void
    selectedEnvironment: Environment
    variant: Variant
} & React.ComponentProps<typeof Modal>

const {Title} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        gap: theme.paddingLG,
        padding: `${theme.paddingLG}px 0`,
        height: 760,
    },
    title: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    subTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
    modalTitle: {
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading5,
            fontWeight: theme.fontWeightMedium,
            textTransform: "capitalize",
        },
    },
}))

const DeploymentHistoryModal = ({
    selectedEnvironment,
    setIsHistoryModalOpen,
    variant,
    ...props
}: DeploymentHistoryModalProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const [depRevisionsList, setDepRevisionsList] = useState<DeploymentRevisions | null>(null)
    const [depRevisionConfig, setDepRevisionConfig] = useState<DeploymentRevisionConfig | null>(
        null,
    )
    const [activeDepRevisionConfig, setActiveDepRevisionConfig] =
        useState<DeploymentRevisionConfig | null>(null)
    const [isDepRevisionLoading, setIsDepRevisionLoading] = useState(false)
    const [isDepRevisionConfigLoading, setIsDepRevisionConfigLoading] = useState(false)
    const [selectedDepRevision, setSelectedDepRevision] = useState<DeploymentRevision | null>(null)
    const [compareDeployment, setCompareDeployment] = useState(false)
    const [confirmDepModalOpen, setConfirmDepModalOpen] = useState(false)

    const [isRevertDeploymentLoading, setIsRevertDeploymentLoading] = useState(false)
    const [selectedRevert, setSelectedRevert] = useState<DeploymentRevision | null>(null)

    const [selectedRevisionNumber, setSelectedRevisionNumber] = useState<number | null>(null)

    const fetchControllerRef = useRef<AbortController | null>(null)

    const deployedAppRevisionId = useMemo(() => {
        return depRevisionsList?.deployed_app_variant_revision_id || null
    }, [depRevisionsList])

    const deployedAppRevision = useMemo(() => {
        return depRevisionsList?.revisions.find(
            (rev) => rev.deployed_app_variant_revision === deployedAppRevisionId,
        )
    }, [depRevisionsList, deployedAppRevisionId])

    const fetchDevRevisionConfig = useCallback(async (record: string) => {
        try {
            const mod = await import("@/oss/services/deploymentVersioning/api")
            const fetchAllDeploymentRevisionConfig = mod?.fetchAllDeploymentRevisionConfig
            if (!mod || !fetchAllDeploymentRevisionConfig) return

            const data = await fetchAllDeploymentRevisionConfig(record, undefined, true)
            setActiveDepRevisionConfig(data)
        } catch (error) {
            console.error("Failed to fetch deployment revision config:", error)
        }
    }, [])

    useEffect(() => {
        if (deployedAppRevision?.id) {
            fetchDevRevisionConfig(deployedAppRevision.id)
        }
    }, [deployedAppRevision, fetchDevRevisionConfig])

    const isShowingCurrentDeployment = useMemo(() => {
        return deployedAppRevisionId === selectedDepRevision?.deployed_app_variant_revision
    }, [deployedAppRevisionId, selectedDepRevision])

    const fetchDevRevisions = useCallback(async () => {
        setIsDepRevisionLoading(true)
        try {
            const mod = await import("@/oss/services/deploymentVersioning/api")
            const fetchAllDeploymentRevisions = mod?.fetchAllDeploymentRevisions
            if (!mod || !fetchAllDeploymentRevisions) return

            const data = await fetchAllDeploymentRevisions(appId, selectedEnvironment.name)
            setDepRevisionsList(data)
            setSelectedDepRevision(data.revisions.reverse()[0] || null)
            const totalRows = data?.revisions.length as number
            setSelectedRevisionNumber(totalRows || null)
        } catch (error) {
            console.error("Failed to fetch deployment revisions:", error)
        } finally {
            setIsDepRevisionLoading(false)
        }
    }, [appId, selectedEnvironment])

    const handleRevertDeployment = async (deploymentRevisionId: string) => {
        try {
            setIsRevertDeploymentLoading(true)
            const mod = await import("@/oss/services/deploymentVersioning/api")
            const createRevertDeploymentRevision = mod?.createRevertDeploymentRevision
            if (!mod || !createRevertDeploymentRevision) return

            await createRevertDeploymentRevision(deploymentRevisionId)
            await fetchDevRevisions()
            message.success("Environment successfully reverted to deployment revision")
        } catch (error) {
            console.error(error)
        } finally {
            setIsRevertDeploymentLoading(false)
        }
    }

    const fetchDevRevisionConfigById = useCallback(async (revisionId: string) => {
        fetchControllerRef.current?.abort()
        const controller = new AbortController()
        fetchControllerRef.current = controller

        try {
            setIsDepRevisionConfigLoading(true)
            const mod = await import("@/oss/services/deploymentVersioning/api")
            const fetchAllDeploymentRevisionConfig = mod?.fetchAllDeploymentRevisionConfig
            if (!mod || !fetchAllDeploymentRevisionConfig) return

            const data = await fetchAllDeploymentRevisionConfig(revisionId, controller.signal)
            setDepRevisionConfig(data)
        } catch (error) {
            console.error(error)
        } finally {
            setIsDepRevisionConfigLoading(false)
        }
    }, [])

    useEffect(() => {
        if (appId && selectedEnvironment) {
            fetchDevRevisions()
        }
    }, [appId, selectedEnvironment, fetchDevRevisions])

    useEffect(() => {
        if (selectedDepRevision) {
            fetchDevRevisionConfigById(selectedDepRevision.id)
        }
    }, [selectedDepRevision, fetchDevRevisionConfigById])

    const columns: ColumnsType<DeploymentRevision> = [
        {
            title: "Revision",
            dataIndex: "revision",
            key: "revision",
            width: 48,
            render: (_, record, index) => {
                const totalRows = depRevisionsList?.revisions.length as number
                const versionNumber = totalRows - index
                return <span>v{versionNumber}</span>
            },
        },
        {
            title: "Modified by",
            dataIndex: "modified_by",
            key: "modified_by",
            render: (_, record) => <span>{record.modified_by}</span>,
        },
        {
            title: "Created on",
            dataIndex: "created_at",
            key: "created_at",
            render: (_, record) => <span>{formatDay({date: record.created_at})}</span>,
        },
        {
            title: <GearSix size={16} />,
            key: "actions",
            width: 56,
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
                                    setConfirmDepModalOpen(true)
                                    setSelectedRevert(record)
                                },
                                disabled:
                                    activeDepRevisionConfig?.current_version === record.revision,
                            },
                            {
                                key: "compare_to_current",
                                label: "Compare to current",
                                icon: <SwapOutlined />,
                                onClick: (event) => {
                                    event.domEvent.stopPropagation()
                                    setSelectedDepRevision(record)
                                    setCompareDeployment(true)
                                },
                                disabled:
                                    activeDepRevisionConfig?.current_version === record.revision,
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
    ]

    return (
        <>
            <Modal
                footer={null}
                closeIcon={null}
                destroyOnHidden
                title={
                    <Space className={classes.modalTitle}>
                        <Button
                            onClick={() => setIsHistoryModalOpen(false)}
                            type="text"
                            icon={<CloseOutlined />}
                        />
                        <Title>{selectedEnvironment.name} deployment history</Title>
                    </Space>
                }
                width={1200}
                centered
                {...props}
            >
                <div className={classes.container}>
                    <div className="flex-1">
                        {compareDeployment && activeDepRevisionConfig ? (
                            <div className="flex-1 flex flex-col gap-6 overflow-y-auto h-full">
                                <Space>
                                    <Typography.Text className={classes.title}>
                                        Current Deployment
                                    </Typography.Text>
                                </Space>
                                <Space className="justify-between">
                                    <Typography.Text className={classes.subTitle}>
                                        Variant Deployed
                                    </Typography.Text>
                                    {variant && (
                                        <VariantPopover
                                            env={selectedEnvironment}
                                            selectedDeployedVariant={variant}
                                        />
                                    )}
                                </Space>
                                {variant ? (
                                    <HistoryConfig
                                        variant={variant}
                                        depRevisionConfig={activeDepRevisionConfig}
                                    />
                                ) : null}
                            </div>
                        ) : (
                            <Spin spinning={isDepRevisionLoading}>
                                <Table
                                    bordered={true}
                                    className="ph-no-capture"
                                    columns={columns}
                                    rowKey={"id"}
                                    dataSource={depRevisionsList?.revisions || []}
                                    scroll={{x: true}}
                                    onRow={(record, index) => ({
                                        onClick: () => {
                                            const totalRows = depRevisionsList?.revisions
                                                .length as number
                                            setSelectedRevisionNumber(totalRows - (index ?? 0))
                                            setSelectedDepRevision(record)
                                        },
                                        style: {cursor: "pointer"},
                                    })}
                                    pagination={false}
                                />
                            </Spin>
                        )}
                    </div>

                    <div className="flex-1 flex flex-col gap-6 overflow-y-auto">
                        {isDepRevisionConfigLoading || !depRevisionConfig ? (
                            <ContentSpinner />
                        ) : (
                            <>
                                <Space className="justify-between">
                                    <Typography.Text className={classes.title}>
                                        Revision v{selectedRevisionNumber}
                                    </Typography.Text>
                                    {isShowingCurrentDeployment ? (
                                        <Typography.Text>Current Deployment</Typography.Text>
                                    ) : (
                                        <Space>
                                            <Button
                                                size="small"
                                                className="flex items-center gap-2"
                                                onClick={() => {
                                                    setConfirmDepModalOpen(true)
                                                    setSelectedRevert(selectedDepRevision)
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
                                                    Compare to development
                                                </Button>
                                            )}
                                        </Space>
                                    )}
                                </Space>
                                <Space className="justify-between">
                                    <Typography.Text className={classes.subTitle}>
                                        Variant Deployed
                                    </Typography.Text>
                                    {variant && (
                                        <VariantPopover
                                            env={selectedEnvironment}
                                            selectedDeployedVariant={variant}
                                        />
                                    )}
                                </Space>
                                {variant ? (
                                    <HistoryConfig
                                        variant={variant}
                                        depRevisionConfig={depRevisionConfig}
                                    />
                                ) : null}
                            </>
                        )}
                    </div>
                </div>
            </Modal>

            {selectedRevert && (
                <DeploymentRevertModal
                    open={confirmDepModalOpen}
                    onCancel={() => setConfirmDepModalOpen(false)}
                    onOk={async () => {
                        await handleRevertDeployment(selectedRevert.id)
                        setConfirmDepModalOpen(false)
                    }}
                    selectedRevert={selectedRevert}
                    selectedEnvironment={selectedEnvironment}
                    okButtonProps={{loading: isRevertDeploymentLoading}}
                    selectedDeployedVariant={variant}
                />
            )}
        </>
    )
}

export default DeploymentHistoryModal
