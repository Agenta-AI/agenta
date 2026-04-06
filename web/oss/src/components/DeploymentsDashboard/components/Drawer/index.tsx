import {ComponentProps, ReactNode, useMemo, useState} from "react"

import {environmentsListQueryAtomFamily} from "@agenta/entities/environment"
import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Divider, Drawer} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {deploymentsDrawerStateAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentDrawerStore"
import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"

import UseApiContent from "../../assets/UseApiContent"
import VariantUseApiContent from "../../assets/VariantUseApiContent"
import {openSelectDeployVariantModalAtom} from "../../modals/store/deploymentModalsStore"

import DrawerDetails from "./assets/DrawerDetails"
import DrawerTitle from "./assets/DrawerTitle"

type DeploymentsDrawerProps = {
    mainContent?: ReactNode
    envName?: string
    headerContent?: ReactNode
    selectedRevisionId?: string
    expandable?: boolean
    initialWidth?: number
    mainContentClassName?: string
    drawerVariantId?: string
    mode?: "deployment" | "variant"
} & ComponentProps<typeof Drawer>

interface DeploymentsDrawerTitleProps extends Pick<
    DeploymentsDrawerProps,
    "onClose" | "expandable" | "initialWidth" | "selectedRevisionId"
> {
    drawerWidth: number
    setDrawerWidth: (width: number) => void
    envName?: string
    headerContent?: ReactNode
    initialWidth?: number
    mainContentClassName?: string
    selectedRevisionId?: string
    onClose?: (e: any) => void
}

const DeploymentsDrawerTitle = ({
    drawerWidth,
    initialWidth,
    setDrawerWidth,
    expandable,
    onClose,
}: DeploymentsDrawerTitleProps) => {
    return (
        <div className="flex items-center justify-between gap-3">
            <Button onClick={() => onClose?.({} as any)} type="text" icon={<CloseOutlined />} />

            {expandable && (
                <Button
                    onClick={() => {
                        if (drawerWidth === (initialWidth ?? 1200)) {
                            setDrawerWidth(1920)
                        } else {
                            setDrawerWidth(initialWidth ?? 1200)
                        }
                    }}
                    type="text"
                    icon={
                        drawerWidth === initialWidth ? (
                            <FullscreenOutlined />
                        ) : (
                            <FullscreenExitOutlined />
                        )
                    }
                />
            )}

            <div className="flex-1">
                <DrawerTitle>How to use API</DrawerTitle>
            </div>
        </div>
    )
}

const DeploymentsDrawerContent = ({
    mainContentClassName,
    selectedRevisionId,
    drawerVariantId,
    mode = "deployment",
}: DeploymentsDrawerProps) => {
    const drawerState = useAtomValue(deploymentsDrawerStateAtom)
    const envName = drawerState.envName || ""

    // Resolve deployed revision ID from environment entities
    const entityEnvironments = useAtomValue(environmentsListQueryAtomFamily(false))
    const deployedRevisionId = useMemo(() => {
        if (!envName) return null
        const envs = entityEnvironments.data?.environments ?? []
        const env = envs.find(
            (e) =>
                e.name === envName ||
                e.slug === envName ||
                e.name?.toLowerCase() === envName.toLowerCase(),
        )
        if (!env) return null

        const refs = env.data?.references ?? {}
        const firstKey = Object.keys(refs)[0]
        const appRef = firstKey ? refs[firstKey] : null
        return appRef?.application_revision?.id ?? null
    }, [envName, entityEnvironments.data])

    const openSelectDeployVariantModal = useSetAtom(openSelectDeployVariantModalAtom)
    const handleOpenSelectDeployVariantModal = () => openSelectDeployVariantModal({envName})

    const isVariantMode = mode === "variant"
    const initialVariantRevisionId = drawerVariantId || selectedRevisionId

    const renderContent = () => {
        if (isVariantMode) {
            return <VariantUseApiContent initialRevisionId={initialVariantRevisionId} />
        }

        return (
            <UseApiContent
                handleOpenSelectDeployVariantModal={handleOpenSelectDeployVariantModal}
                revisionId={drawerVariantId}
                deployedRevisionId={deployedRevisionId}
                envName={envName}
            />
        )
    }

    return (
        <div className="flex h-full">
            <div className={`flex-1 overflow-auto ${mainContentClassName}`}>
                <div
                    className={clsx([
                        "[&_.ant-tabs-nav]:sticky",
                        "[&_.ant-tabs-nav]:px-4",
                        "[&_.ant-tabs-nav]:-top-[25px]",
                        "[&_.ant-tabs-nav]:bg-white",
                        "[&_.ant-tabs-nav]:z-[1]",
                        "[&_.ant-tabs-nav]:m-0",
                        "[&_.ant-tabs-content-holder]:p-4",
                        "h-full",
                        "[&_.ant-tabs]:h-full",
                        "[&_.ant-tabs-content]:h-full",
                        "[&_.ant-tabs-tabpane]:h-full",
                    ])}
                >
                    {renderContent()}
                </div>
            </div>
            {drawerVariantId && (
                <>
                    <Divider orientation="vertical" className="h-full m-0" />
                    <DrawerDetails revisionId={drawerVariantId} />
                </>
            )}
        </div>
    )
}

const DeploymentsDrawer = ({
    mainContent,
    headerContent,
    expandable = true,
    initialWidth = 1200,
    mainContentClassName = "",
    selectedRevisionId,
    drawerVariantId,
    mode = "deployment",
    ...props
}: DeploymentsDrawerProps) => {
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    return (
        <EnhancedDrawer
            closeIcon={null}
            destroyOnHidden
            width={drawerWidth}
            className="[&_.ant-drawer-body]:p-0"
            title={
                <DeploymentsDrawerTitle
                    drawerWidth={drawerWidth}
                    setDrawerWidth={setDrawerWidth}
                    headerContent={headerContent}
                    expandable={expandable}
                    initialWidth={initialWidth}
                    mainContentClassName={mainContentClassName}
                    selectedRevisionId={selectedRevisionId}
                    {...props}
                />
            }
            {...props}
        >
            <DeploymentsDrawerContent
                drawerVariantId={drawerVariantId}
                selectedRevisionId={selectedRevisionId}
                mode={mode}
            >
                {mainContent}
            </DeploymentsDrawerContent>
        </EnhancedDrawer>
    )
}

export default DeploymentsDrawer
