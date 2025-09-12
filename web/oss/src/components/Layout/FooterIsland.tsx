import {memo} from "react"

import {GithubFilled, LinkedinFilled, TwitterOutlined} from "@ant-design/icons"
import {Layout, Space, Typography} from "antd"
import Link from "next/link"

const {Footer} = Layout

interface FooterIslandProps {
    className?: string
}

export const FooterIsland = memo(function FooterIsland({className}: FooterIslandProps) {
    return (
        <Footer className={className}>
            <Space size={10}>
                <Link href="https://github.com/Agenta-AI/agenta" target="_blank">
                    <GithubFilled />
                </Link>
                <Link href="https://www.linkedin.com/company/agenta-ai/" target="_blank">
                    <LinkedinFilled />
                </Link>
                <Link href="https://twitter.com/agenta_ai" target="_blank">
                    <TwitterOutlined />
                </Link>
            </Space>
            <Typography.Text>Copyright © {new Date().getFullYear()} | Agenta.</Typography.Text>
        </Footer>
    )
})
