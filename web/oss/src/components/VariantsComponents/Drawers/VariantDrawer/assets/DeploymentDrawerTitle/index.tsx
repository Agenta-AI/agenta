import {memo} from "react"
import {CloseOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise} from "@phosphor-icons/react"
import {Button, Tag} from "antd"

import {DeploymentDrawerTitleProps} from "../types"
import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import {useRouter} from "next/router"

const DeploymentDrawerTitle = ({selectedVariant, onClose, revert}: DeploymentDrawerTitleProps) => {
    const router = useRouter()

    return (
        <section className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Button onClick={onClose} type="text" icon={<CloseOutlined />} size="small" />

                <div className="flex items-center gap-2">
                    {/*TODO: update this with select variant deployment */}
                    <EnvironmentTagLabel environment={router.query.selectedEnvName as string} />
                    <Tag bordered={false} className="bg-[#0517290F]">
                        v{selectedVariant?.revision}
                    </Tag>
                </div>
            </div>

            <Button
                icon={<ArrowCounterClockwise size={16} />}
                size="small"
                disabled={revert?.isDisabled}
                loading={revert?.isLoading}
                onClick={revert?.onClick}
            >
                Revert
            </Button>
        </section>
    )
}

export default memo(DeploymentDrawerTitle)
