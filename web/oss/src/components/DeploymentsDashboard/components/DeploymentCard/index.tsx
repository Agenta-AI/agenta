import type {ComponentProps} from "react"
import {useMemo} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {dayjs} from "@agenta/shared/utils"
import {Card, Space, Tag, Typography} from "antd"
import {atom, useAtomValue} from "jotai"

import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import VariantNameCell from "@/oss/components/VariantNameCell"
import {Environment} from "@/oss/lib/Types"

import {useDeploymentCardStyles} from "./styles"

type DeploymentCardProps = {
    env: Environment
    selectedEnv?: string
} & ComponentProps<typeof Card>

const DeploymentCard = ({env, selectedEnv, ...props}: DeploymentCardProps) => {
    const classes = useDeploymentCardStyles()

    const revisionId = env?.deployed_app_variant_revision_id || undefined
    const revision = useAtomValue(
        useMemo(
            () =>
                revisionId ? legacyAppRevisionMolecule.atoms.serverData(revisionId) : atom(null),
            [revisionId],
        ),
    ) as any

    const lastModifiedText = useMemo(() => {
        if (!revision) return "-"
        const raw =
            (revision as any)?.updatedAtTimestamp ??
            (revision as any)?.createdAtTimestamp ??
            (revision as any)?.updatedAt ??
            (revision as any)?.createdAt
        if (!raw) return "-"
        const d = dayjs.utc(typeof raw === "number" ? raw : String(raw))
        return d.isValid() ? d.local().format("MMM D, YYYY h:mm A") : "-"
    }, [revision])

    return (
        <Card
            className={classes.deploymentCard}
            style={{
                borderColor: selectedEnv === env.name ? "#1C2C3D" : undefined,
            }}
            {...props}
        >
            <EnvironmentTagLabel environment={env.name} />

            <Space className="justify-between">
                <Typography.Text>Variant</Typography.Text>
                {revisionId ? (
                    <VariantNameCell revisionId={revisionId} showBadges={false} showStable />
                ) : (
                    <Tag onClick={(e) => e.stopPropagation()}>No deployment</Tag>
                )}
            </Space>
            <Space className="justify-between">
                <Typography.Text>Last modified</Typography.Text>
                <Typography.Text>{lastModifiedText}</Typography.Text>
            </Space>
        </Card>
    )
}

export default DeploymentCard

export {default as DeploymentCardSkeleton, DEPLOYMENT_SKELETON_ENVIRONMENTS} from "./skeleton"
