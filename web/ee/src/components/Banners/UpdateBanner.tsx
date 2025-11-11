import {memo} from "react"
import {Tag, Typography} from "antd"
import Link from "next/link"
import {CloseOutlined} from "@ant-design/icons"

import {SidebarUpdate} from "@/oss/components/SidePanel/assets/updates"

const UpdateBanner = ({update, onClose}: {update: SidebarUpdate; onClose: () => void}) => {
    return (
        <section className="relative p-4 rounded-lg flex flex-col gap-2 bg-[#F5F7FA]">
            <div className="absolute left-2 top-2 flex items-center gap-2">
                <Tag className="text-[10px] font-medium" color="#E6F4FF" bordered={false}>
                    <span className="text-[#1677FF]">What's new</span>
                </Tag>
            </div>
            <CloseOutlined
                onClick={onClose}
                className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
            />
            <Typography.Text className="mt-4 text-base font-semibold">{update.title}</Typography.Text>
            <Typography.Text className="text-sm text-[#586673]">{update.description}</Typography.Text>
            {update.link ? (
                <Link
                    href={update.link}
                    className="text-sm text-blue-600 hover:text-blue-800 underline underline-offset-1"
                >
                    Learn more
                </Link>
            ) : null}
        </section>
    )
}

export default memo(UpdateBanner)
