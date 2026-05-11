import {useCallback} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {publishMutationAtom} from "@agenta/entities/runnable"
import type {Workflow} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {Rocket} from "@phosphor-icons/react"
import {Modal, Typography} from "antd"
import {useAtomValue} from "jotai"
import {createUseStyles} from "react-jss"

import type {JSSTheme} from "@/oss/lib/Types"

type DeploymentModalProps = {
    selectedEnvironment: AppEnvironmentDeployment
    selectedVariant: Workflow
    loadEnvironments: () => Promise<void>
    setIsDeploymentModalOpen: (value: React.SetStateAction<boolean>) => void
} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& .ant-modal-footer": {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
        },
    },
    wrapper: {
        "& h1": {
            fontSize: theme.fontSizeLG,
            fontWeight: theme.fontWeightStrong,
            lineHeight: theme.lineHeightLG,
            marginBottom: 8,
        },
        "& span": {
            color: theme.colorPrimary,
            fontSize: theme.fontSizeLG,
            lineHeight: theme.lineHeightLG,
            fontWeight: theme.fontWeightMedium,
        },
    },
}))

const DeploymentModal = ({
    selectedEnvironment,
    selectedVariant,
    loadEnvironments: _loadEnvironments,
    setIsDeploymentModalOpen,
    ...props
}: DeploymentModalProps) => {
    const classes = useStyles()
    const {isPending: isPublishVariantLoading, mutateAsync: publish} =
        useAtomValue(publishMutationAtom)

    const publishVariant = useCallback(async () => {
        try {
            if (!selectedEnvironment || !selectedVariant) return

            await publish({
                revisionId: selectedVariant.id,
                environmentSlug: selectedEnvironment.name,
                applicationId: selectedVariant.workflow_id || "",
                workflowVariantId: selectedVariant.workflow_variant_id ?? undefined,
                variantSlug: selectedVariant.slug ?? undefined,
                revisionVersion: selectedVariant.version ?? undefined,
            })
            message.success(`Published ${selectedVariant.name} to ${selectedEnvironment.name}`)
        } catch (error) {
            console.error(error)
        } finally {
            setIsDeploymentModalOpen(false)
        }
    }, [selectedEnvironment, selectedVariant, publish, setIsDeploymentModalOpen])

    return (
        <Modal
            className={classes.container}
            okText={
                <div className="flex gap-2 items-center">
                    <Rocket size={16} />
                    Deploy
                </div>
            }
            onOk={publishVariant}
            okButtonProps={{loading: isPublishVariantLoading}}
            centered
            {...props}
        >
            <div className={classes.wrapper}>
                <Typography.Title>Confirm Deployment</Typography.Title>

                <div className="flex flex-col gap-4">
                    <div>
                        You are about to deploy {selectedVariant.name}{" "}
                        <span className="bg-[rgba(5,23,41,0.06)] px-2 !text-xs">
                            {selectedVariant.version}
                        </span>{" "}
                        to {selectedEnvironment.name} environment. This will overwrite the existing
                        configuration. This change will affect all future calls to this environment.
                    </div>
                    <div className="flex flex-col">
                        You are about to deploy {selectedEnvironment.name} environment:
                        <span>Revision v{selectedEnvironment.revision || 0}</span>
                    </div>
                </div>
            </div>
        </Modal>
    )
}

export default DeploymentModal
