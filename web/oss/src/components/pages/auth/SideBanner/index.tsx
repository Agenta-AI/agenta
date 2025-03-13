import {memo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import Image from "next/image"

const {Title} = Typography

const SideBanner = () => {
    return (
        <section
            className={clsx([
                "w-1/2 h-screen  relative",
                "hidden lg:flex",
                "flex-col items-center justify-center gap-10",
            ])}
        >
            <div
                className="w-full h-screen bg-repeat-y object-cover absolute -z-0 top-0 left-0 right-0 bottom-0"
                style={{backgroundImage: "url('/assets/onboard-page-grids.svg')"}}
            ></div>

            <div className="w-[400px] gap-4">
                <Title level={3} className="font-bold">
                    Build Robust AI Applications
                </Title>
                <Typography.Paragraph className="text-sm text-[#586673]">
                    Streamline the development of your LLM applications. Experiment, evaluate, and
                    monitor AI applications faster and easier than ever before. Empower your team
                    with seamless collaboration.
                </Typography.Paragraph>
            </div>
            <Image
                src="/assets/On-boarding.webp"
                alt="agenta-ai"
                width={492}
                height={392}
                className="w-[492px] h-[392px] 2xl:w-[55%] 2xl:h-auto object-cover"
            />
        </section>
    )
}

export default memo(SideBanner)
