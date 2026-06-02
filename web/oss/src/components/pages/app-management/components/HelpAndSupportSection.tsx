import {ArrowRight, BookOpen, Code, HandWaving} from "@phosphor-icons/react"
import {Space, Typography} from "antd"
import Link from "next/link"

const {Text, Title} = Typography

// These cards are <a> tags; without an explicit color the text + icons
// inherit antd's colorLink (blue in dark). Use neutral text color (text-colorText)
// so the cards read as content, not links.
const helperCardClass =
    "max-w-[400px] flex-1 gap-3 cursor-pointer flex items-center transition-all duration-[25ms] ease-in border border-colorBorderSecondary rounded-md p-3 text-colorText [&_span.ant-typography]:overflow-hidden [&_span.ant-typography]:text-ellipsis [&_span.ant-typography]:whitespace-nowrap [&_span.ant-typography]:text-base [&_span.ant-typography]:font-medium [&_span.ant-typography]:leading-normal [&_span.ant-typography]:flex-1 hover:shadow-[0_1px_2px_0_rgba(0,0,0,0.03),0_1px_6px_-1px_rgba(0,0,0,0.02),0_2px_4px_0_rgba(0,0,0,0.02)]"

const HelpAndSupportSection = () => {
    return (
        <div className="flex flex-col gap-4">
            <Space orientation="vertical" size={8}>
                <Title level={2} className="!my-0">
                    Have a question?
                </Title>
                <Text>Checkout our docs or send us a message on slack.</Text>
            </Space>

            <div className="flex items-center w-full gap-4">
                <Link className={helperCardClass} href="https://agenta.ai/docs/" target="_blank">
                    <BookOpen size={24} />
                    <Text>Check out docs</Text>
                    <ArrowRight size={18} />
                </Link>
                <Link
                    href="https://github.com/Agenta-AI/agenta/discussions"
                    target="_blank"
                    className={helperCardClass}
                >
                    <Code size={24} />
                    <Text>Create a discussion in Github</Text>
                    <ArrowRight size={18} />
                </Link>
                <Link
                    href="https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw"
                    target="_blank"
                    className={helperCardClass}
                >
                    <HandWaving size={24} />
                    <Text>Say hello at Slack</Text>
                    <ArrowRight size={18} />
                </Link>
            </div>
        </div>
    )
}

export default HelpAndSupportSection
