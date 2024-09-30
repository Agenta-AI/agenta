import React from "react"
import Image from "next/image"
import {Typography} from "antd"
import AppTemplateCard from "./AppTemplateCard"

interface Props {
    onWriteOwnApp: () => void
    onCreateFromTemplate: () => void
}

const Welcome: React.FC<Props> = ({onWriteOwnApp, onCreateFromTemplate}) => {
    return (
        <section className="h-[75vh] flex flex-col justify-center gap-10">
            <div className="text-center">
                <Image
                    src="/assets/light-complete-transparent-CROPPED.png"
                    alt="agenta-ai"
                    width={114}
                    height={40}
                    className="block mx-auto"
                />
                <Typography.Title level={3}>
                    Start building and testing your LLM <br /> applications with Agenta AI.{" "}
                </Typography.Title>
            </div>

            <div className="flex items-center justify-center gap-4">
                <AppTemplateCard
                    onWriteOwnApp={onWriteOwnApp}
                    onCreateFromTemplate={onCreateFromTemplate}
                />
            </div>
        </section>
    )
}
export default Welcome
