import {useCallback, useState} from "react"

import {Rocket} from "@phosphor-icons/react"
import {Modal, Typography} from "antd"
import {useAtomValue} from "jotai"
import {createUseStyles} from "react-jss"

import {message} from "@/oss/components/AppMessageContext"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {Environment, JSSTheme} from "@/oss/lib/Types"
import {publishMutationAtom} from "@/oss/state/deployment/atoms/publish"

type DeploymentModalProps = {
    selectedEnvironment: Environment
    selectedVariant: EnhancedVariant
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
    loadEnvironments,
    setIsDeploymentModalOpen,
    ...props
}: DeploymentModalProps) => {
    const classes = useStyles()
    const {isPending: isPublishVariantLoading, mutateAsync: publish} =
        useAtomValue(publishMutationAtom)

    const publishVariant = useCallback(async () => {
        try {
            if (!selectedEnvironment || !selectedVariant) return

            await publish(
                selectedVariant._parentVariant
                    ? {
                          type: "revision",
                          revision_id: selectedVariant.id,
                          environment_ref: selectedEnvironment.name,
                          note: "",
                      }
                    : {
                          type: "variant",
                          variant_id: selectedVariant.variantId,
                          revision_id: selectedVariant.id,
                          environment_name: selectedEnvironment.name,
                          note: "",
                      },
            )
            message.success(
                `Published ${selectedVariant.variantName} to ${selectedEnvironment.name}`,
            )
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
                        You are about to deploy {selectedVariant.variantName}{" "}
                        <span className="bg-[rgba(5,23,41,0.06)] px-2 !text-xs">
                            {selectedVariant.revision}
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
