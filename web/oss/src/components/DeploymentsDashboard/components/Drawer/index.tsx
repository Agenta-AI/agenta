import {ComponentProps, ReactNode, useMemo, useState} from "react"

import {environmentsListQueryAtomFamily} from "@agenta/entities/environment"
import {Button} from "@agenta/primitive-ui/components/button"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Divider} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {deploymentsDrawerStateAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentDrawerStore"
import {currentAppAtom} from "@/oss/state/app"

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
} & ComponentProps<typeof EnhancedDrawer>

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
            <Button onClick={() => onClose?.({} as any)} variant="ghost" size="icon">
                {<CloseOutlined />}
            </Button>

            {expandable && (
                <Button
                    onClick={() => {
                        if (drawerWidth === (initialWidth ?? 1200)) {
                            setDrawerWidth(1920)
                        } else {
                            setDrawerWidth(initialWidth ?? 1200)
                        }
                    }}
                    variant="ghost"
                    size="icon"
                >
                    {drawerWidth === initialWidth ? (
                        <FullscreenOutlined />
                    ) : (
                        <FullscreenExitOutlined />
                    )}
                </Button>
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

    // Resolve deployed revision ID from environment entities, scoped to the current app
    const currentApp = useAtomValue(currentAppAtom)
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
        const currentAppId = currentApp?.id
        const currentAppSlug = currentApp?.slug

        // Find the reference entry that belongs to the current app
        for (const appRef of Object.values(refs)) {
            const ref = appRef as Record<string, {id?: string; slug?: string; version?: string}>
            const appEntry = ref?.application
            if (
                (currentAppId && appEntry?.id === currentAppId) ||
                (currentAppSlug && appEntry?.slug === currentAppSlug)
            ) {
                return ref?.application_revision?.id ?? null
            }
        }

        return null
    }, [envName, entityEnvironments.data, currentApp?.id, currentApp?.slug])

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
                <div className="h-full">{renderContent()}</div>
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
