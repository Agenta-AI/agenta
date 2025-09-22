import {memo} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise} from "@phosphor-icons/react"
import {Button, Tag} from "antd"
import {useAtomValue} from "jotai"

import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms"
import {useQueryParam} from "@/oss/hooks/useQuery"

import {DeploymentDrawerTitleProps} from "../types"
import {drawerVariantIsLoadingAtomFamily} from "../VariantDrawerContent"

const DeploymentDrawerTitle = ({variantId, onClose, revert}: DeploymentDrawerTitleProps) => {
    const selectedVariant = useAtomValue(variantByRevisionIdAtomFamily(variantId))
    const [envName] = useQueryParam("selectedEnvName")
    const isLoading = useAtomValue(drawerVariantIsLoadingAtomFamily(variantId))
    return (
        <section className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Button onClick={onClose} type="text" icon={<CloseOutlined />} size="small" />

                <div className="flex items-center gap-2">
                    {/*TODO: update this with select variant deployment */}
                    <EnvironmentTagLabel environment={envName || ""} />
                    <Tag bordered={false} className="bg-[#0517290F]">
                        v{selectedVariant?.revision}
                    </Tag>
                </div>
            </div>

            <Button
                icon={<ArrowCounterClockwise size={16} />}
                size="small"
                disabled={revert?.isDisabled || isLoading}
                loading={revert?.isLoading}
                onClick={revert?.onClick}
            >
                Revert
            </Button>
        </section>
    )
}

export default memo(DeploymentDrawerTitle)
