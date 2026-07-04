import {CopyButton} from "@agenta/ui"
import {Flex, Space} from "antd"
import {IBM_Plex_Mono} from "next/font/google"

const ibm_plex_mono = IBM_Plex_Mono({weight: "400", subsets: ["latin"]})

export const TracingCodeComponent = ({
    command: {title, code},
    index,
}: {
    command: {title: string; code: string}
    index: number
}) => {
    return (
        <div className="flex flex-col gap-2">
            <Flex align="center" justify="space-between">
                <Space>
                    <span>{index + 1}.</span>
                    <span>{title}</span>
                </Space>
                <CopyButton buttonText={""} icon text={code} />
            </Flex>
            <div className="p-2 bg-colorBgContainerDisabled rounded-lg overflow-auto">
                <pre className={`m-0 ${ibm_plex_mono.className}`}>{code}</pre>
            </div>
        </div>
    )
}
