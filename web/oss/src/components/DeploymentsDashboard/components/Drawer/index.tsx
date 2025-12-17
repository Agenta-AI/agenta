import {ComponentProps, ReactNode, useState} from "react"

import {CloseOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {Button, Divider, Drawer} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {createUseStyles} from "react-jss"

import {envRevisionsAtom} from "@/oss/components/DeploymentsDashboard/atoms"
import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {JSSTheme} from "@/oss/lib/Types"
import {revisionListAtom} from "@/oss/state/variant/selectors/variant"

import UseApiContent from "../../assets/UseApiContent"

import DrawerDetails from "./assets/DrawerDetails"
import DrawerTitle from "./assets/DrawerTitle"

type DeploymentsDrawerProps = {
    mainContent: ReactNode
    // Prefer passing envName to render title efficiently; headerContent kept for backward-compat
    envName?: string
    headerContent?: ReactNode
    // Optional: pass a revision id to render details lazily
    selectedRevisionId?: string
    expandable?: boolean
    initialWidth?: number
    mainContentClassName?: string
    drawerVariantId?: string
} & ComponentProps<typeof Drawer>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    // Title and subtitle styles moved to DrawerTitle/DrawerDetails components
    drawerContainer: {
        "& .ant-drawer-body": {
            padding: 0,
        },
    },
}))

interface DeploymentsDrawerTitleProps
    extends Pick<
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
                        if (drawerWidth === initialWidth) {
                            setDrawerWidth(1920)
                        } else {
                            setDrawerWidth(initialWidth)
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
}: DeploymentsDrawerProps) => {
    const variants = useAtomValue(revisionListAtom) || []
    const envRevisions = useAtomValue(envRevisionsAtom)
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
                    {envRevisions ? (
                        <UseApiContent
                            handleOpenSelectDeployVariantModal={() => close()}
                            variants={variants}
                            revisionId={drawerVariantId}
                            selectedEnvironment={envRevisions}
                        />
                    ) : (
                        <div className="p-4">
                            <div className="animate-pulse h-4 w-48 bg-gray-200 rounded mb-3" />
                            <div className="animate-pulse h-4 w-72 bg-gray-200 rounded mb-2" />
                            <div className="animate-pulse h-4 w-64 bg-gray-200 rounded" />
                        </div>
                    )}
                </div>
            </div>
            {drawerVariantId && (
                <>
                    <Divider type="vertical" className="h-full m-0" />
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
    ...props
}: DeploymentsDrawerProps) => {
    const classes = useStyles()
    const [drawerWidth, setDrawerWidth] = useState(initialWidth)

    return (
        <EnhancedDrawer
            closeIcon={null}
            destroyOnHidden
            width={drawerWidth}
            className={classes.drawerContainer}
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
            <DeploymentsDrawerContent drawerVariantId={drawerVariantId}>
                {mainContent}
            </DeploymentsDrawerContent>
        </EnhancedDrawer>
    )
}

export default DeploymentsDrawer
