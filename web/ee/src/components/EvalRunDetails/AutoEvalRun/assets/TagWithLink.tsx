import {ArrowSquareOut} from "@phosphor-icons/react"
import {Tag, TagProps} from "antd"
import clsx from "clsx"
import {useRouter} from "next/router"

interface TagWithLinkProps extends TagProps {
    name: string
    href: string
    showIcon?: boolean
}
const TagWithLink = ({name, href, className, showIcon = true, ...props}: TagWithLinkProps) => {
    const router = useRouter()
    return (
        <Tag
            bordered={false}
            className={clsx(
                "flex items-center gap-1 bg-[#0517290F] hover:bg-[#05172916] w-fit cursor-pointer group",
                className,
            )}
            onClick={() => router.push(href)}
            {...props}
        >
            {name}{" "}
            {showIcon && (
                <ArrowSquareOut
                    size={14}
                    className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
            )}
        </Tag>
    )
}

export default TagWithLink
