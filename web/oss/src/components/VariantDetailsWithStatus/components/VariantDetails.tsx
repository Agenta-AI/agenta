import {PencilSimpleLine} from "@phosphor-icons/react"
import {Space, Tag, Typography} from "antd"

import {Variant} from "@/oss/lib/Types"

interface VariantDetailsProps {
    variantName?: string
    revision?: number | string | null
    variant?: Pick<Variant, "isLatestRevision" | "deployedIn"> & {isDraft?: boolean}
    showRevisionAsTag?: boolean
}

const VariantDetails = ({
    variantName,
    revision,
    variant,
    showRevisionAsTag = true,
}: VariantDetailsProps) => {
    return (
        <Space size={4}>
            {variantName ? <Typography>{variantName}</Typography> : null}
            {revision !== undefined &&
                (showRevisionAsTag ? (
                    <Tag className={`bg-[rgba(5,23,41,0.06)]`} bordered={false}>
                        v{revision}
                    </Tag>
                ) : (
                    <Typography.Text>v{revision}</Typography.Text>
                ))}

            {variant?.isDraft ? (
                <Tag
                    color="#586673"
                    bordered={false}
                    className="flex items-center gap-1 font-normal"
                >
                    <PencilSimpleLine size={14} /> Draft
                </Tag>
            ) : (
                variant &&
                variant.isLatestRevision && (
                    <Tag className={`bg-[#E6F4FF] text-[#1677FF]`} bordered={false}>
                        Latest
                    </Tag>
                )
            )}
        </Space>
    )
}

export default VariantDetails
