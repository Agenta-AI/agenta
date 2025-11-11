import {memo} from "react"
import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"
import {Skeleton} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"

const SidebarSkeletonLoader = () => {
    const [collapsed] = useAtom(sidebarCollapsedAtom)
    return (
        <section
            className={clsx(
                "flex flex-col justify-between h-screen border border-r border-solid border-gray-100",
                {
                    "w-[80px] items-center": collapsed,
                    "w-[236px]": !collapsed,
                },
            )}
        >
            <div className="w-full h-full flex flex-col items-center">
                <Skeleton
                    className={clsx(["-mt-1", {"w-[35px]": collapsed, "w-[94%]": !collapsed}])}
                    paragraph={{rows: 1, className: "*:!w-full [&_li]:!h-7"}}
                    title={false}
                    active
                />
                <div className="w-full border border-r border-solid border-gray-100 -mt-[5px]" />
                <Skeleton
                    className={clsx(["mt-1", {"w-[28px]": collapsed, "w-[94%]": !collapsed}])}
                    paragraph={{rows: 4, className: "*:!w-full  [&_li]:!h-6"}}
                    title={false}
                    active
                />
            </div>
            <div className="w-full px-2 flex flex-col items-center">
                <Skeleton
                    className={clsx([{"w-[28px]": collapsed, "w-[94%]": !collapsed}])}
                    paragraph={{rows: 3, className: "*:!w-full [&_li]:!h-6"}}
                    title={false}
                    active
                />
            </div>
        </section>
    )
}

export default memo(SidebarSkeletonLoader)
