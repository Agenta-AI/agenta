import {Typography} from "antd"
import Image from "next/image"

import CreateAppDropdown from "./CreateAppDropdown"

const EmptyAppView = () => {
    return (
        <div className="flex items-center justify-center p-4 rounded-md border border-colorBorderSecondary">
            <div className="py-10 flex flex-col items-center justify-center gap-4 [&_span.ant-typography]:text-xl [&_span.ant-typography]:leading-[1.4] [&_span.ant-typography]:font-medium">
                <Image src="/assets/not-found.png" alt="not-found" width={240} height={210} />
                <Typography.Text>Click here to create your first prompt</Typography.Text>
                <CreateAppDropdown />
            </div>
        </div>
    )
}

export default EmptyAppView
