import {useCallback, useMemo} from "react"

import {Rocket} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import clsx from "clsx"
import Link from "next/link"

import type {RegistryRevisionRow} from "@/oss/components/VariantsComponents/store/registryStore"
import type {RegistryColumnActions} from "@/oss/components/VariantsComponents/Table/assets/registryColumns"
import RegistryTable from "@/oss/components/VariantsComponents/Table/RegistryTable"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQuery} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"

const {Title} = Typography

const VariantsOverview = () => {
    const [, updateQuery] = useQuery()
    const {appURL} = useURL()
    const {goToPlayground} = usePlaygroundNavigation()

    const handleRowClick = useCallback(
        (record: RegistryRevisionRow) => {
            updateQuery({
                revisionId: record.revisionId,
                drawerType: "variant",
            })
        },
        [updateQuery],
    )

    const handleOpenInPlayground = useCallback(
        (record: RegistryRevisionRow) => {
            if (record.revisionId) {
                goToPlayground(record.revisionId)
            } else {
                goToPlayground()
            }
        },
        [goToPlayground],
    )

    const columnActions = useMemo<RegistryColumnActions>(
        () => ({
            handleOpenDetails: handleRowClick,
            handleOpenInPlayground,
        }),
        [handleRowClick, handleOpenInPlayground],
    )

    return (
        <div className={clsx(["flex flex-col gap-2", "[&_>_div_h1.ant-typography]:text-xs"])}>
            <div className="flex items-center justify-between">
                <Title level={3} className="!m-0">
                    Recent Prompts
                </Title>

                <Button
                    type="primary"
                    icon={<Rocket size={14} className="mt-[3px]" />}
                    onClick={() => goToPlayground()}
                >
                    Playground
                </Button>
            </div>

            <RegistryTable
                onRowClick={handleRowClick}
                actions={columnActions}
                scopeId="overview-recent"
                pageSize={5}
                columnVisibilityStorageKey="agenta:overview-registry:column-visibility"
            />

            <div className="flex justify-end">
                <Link href={`${appURL}/variants`} prefetch className="underline">
                    View all prompts →
                </Link>
            </div>
        </div>
    )
}

export default VariantsOverview
