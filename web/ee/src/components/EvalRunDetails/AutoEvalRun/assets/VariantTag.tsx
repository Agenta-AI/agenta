import {useRouter} from "next/router"
import {Tag} from "antd"
import {ArrowSquareOut} from "@phosphor-icons/react"

const VariantTag = ({
    variantName,
    revision,
    id,
}: {
    variantName: string
    revision: number | string
    id: string
}) => {
    const router = useRouter()
    const appId = router.query.app_id as string

    return (
        <Tag
            bordered={false}
            className="flex items-center gap-2 bg-[#0517290F] hover:bg-[#05172916] w-fit cursor-pointer group"
            onClick={() =>
                router.push({
                    pathname: `/apps/${appId}/playground`,
                    query: {
                        revisions: JSON.stringify([id]),
                    },
                })
            }
        >
            {variantName} v{revision} <ArrowSquareOut size={14} className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Tag>
    )
}

export default VariantTag
