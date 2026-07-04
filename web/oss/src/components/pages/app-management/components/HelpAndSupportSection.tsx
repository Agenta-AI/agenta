import {ArrowRight, BookOpen, Code, HandWaving} from "@phosphor-icons/react"
import {Space} from "antd"
import Link from "next/link"

// These cards are <a> tags; without an explicit color the text + icons
// inherit antd's colorLink (blue in dark). Use neutral text color (text-colorText)
// so the cards read as content, not links.
const helperCardClass =
    "max-w-[400px] flex-1 gap-3 cursor-pointer flex items-center transition-all duration-[25ms] ease-in border border-colorBorderSecondary rounded-md p-3 text-colorText [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap [&_span]:text-base [&_span]:font-medium [&_span]:leading-normal [&_span]:flex-1 hover:shadow-[0_1px_2px_0_rgba(0,0,0,0.03),0_1px_6px_-1px_rgba(0,0,0,0.02),0_2px_4px_0_rgba(0,0,0,0.02)]"

const HelpAndSupportSection = () => {
    return (
        <div className="flex flex-col gap-4">
            <Space orientation="vertical" size={8}>
                <h2 className="!my-0 text-xl font-semibold leading-tight">Have a question?</h2>
                <span>Checkout our docs or send us a message on slack.</span>
            </Space>

            <div className="flex items-center w-full gap-4">
                <Link className={helperCardClass} href="https://agenta.ai/docs/" target="_blank">
                    <BookOpen size={24} />
                    <span>Check out docs</span>
                    <ArrowRight size={18} />
                </Link>
                <Link
                    href="https://github.com/Agenta-AI/agenta/discussions"
                    target="_blank"
                    className={helperCardClass}
                >
                    <Code size={24} />
                    <span>Create a discussion in Github</span>
                    <ArrowRight size={18} />
                </Link>
                <Link
                    href="https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw"
                    target="_blank"
                    className={helperCardClass}
                >
                    <HandWaving size={24} />
                    <span>Say hello at Slack</span>
                    <ArrowRight size={18} />
                </Link>
            </div>
        </div>
    )
}

export default HelpAndSupportSection
