import {ArrowSquareOut} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import {
    filteredDeploymentRevisionsAtom,
    selectedRevisionRowAtom,
} from "@/oss/components/DeploymentsDashboard/atoms"
import {useAppId} from "@/oss/hooks/useAppId"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import {JSSTheme} from "@/oss/lib/Types"
import {variantsLoadingAtom} from "@/oss/state/variant/atoms/fetcher"

import VariantDetailsRenderer from "../../../assets/VariantDetailsRenderer"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
    subTitle: {
        fontSize: theme.fontSize,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeight,
    },
}))

interface DrawerDetailsProps {
    revisionId?: string
}

const DrawerDetails = ({revisionId}: DrawerDetailsProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = useAppId()
    const revisions = useAtomValue(filteredDeploymentRevisionsAtom) || []
    const selectedRevisionRow = useAtomValue(selectedRevisionRowAtom)
    const variantsLoading = useAtomValue(variantsLoadingAtom)
    const effectiveId =
        revisionId ||
        selectedRevisionRow?.deployed_app_variant_revision ||
        selectedRevisionRow?.variant?.id
    const record = revisions.find(
        (r) => r.deployed_app_variant_revision === effectiveId || r.variant?.id === effectiveId,
    )

    if (!record) return null

    return (
        <div className={`w-[280px] overflow-auto flex flex-col gap-4 p-4`}>
            <Typography.Text className={classes.title}>Details</Typography.Text>

            <div className="flex flex-col">
                <Typography.Text className={classes.subTitle}>Variant</Typography.Text>

                <Space className="w-full items-center justify-between">
                    <VariantDetailsRenderer
                        record={record as any}
                        isLoading={Boolean(variantsLoading)}
                    />

                    {record.variant && (
                        <Button
                            type="default"
                            onClick={() =>
                                router.push({
                                    pathname: `/apps/${appId}/playground`,
                                    query: {
                                        revisions: buildRevisionsQueryParam([record.variant?.id]),
                                    },
                                })
                            }
                            icon={<ArrowSquareOut size={16} />}
                        />
                    )}
                </Space>
            </div>

            <div className="flex flex-col">
                <Typography.Text className={classes.subTitle}>Date modified</Typography.Text>
                <Tag variant="filled" className="w-fit bg-[#0517290f]">
                    {record?.created_at}
                </Tag>
            </div>

            <div className="flex flex-col">
                <Typography.Text className={classes.subTitle}>Modified by</Typography.Text>
                <Tag variant="filled" className="w-fit bg-[#0517290f]">
                    {record?.modified_by}
                </Tag>
            </div>

            {record?.commit_message && (
                <div className="flex flex-col">
                    <Typography.Text className={classes.subTitle}>Notes</Typography.Text>
                    <Tag variant="filled" className="w-fit bg-[#0517290f]">
                        {record?.commit_message}
                    </Tag>
                </div>
            )}
        </div>
    )
}

export default DrawerDetails
