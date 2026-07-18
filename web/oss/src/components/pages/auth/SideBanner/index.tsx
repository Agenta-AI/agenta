import {memo} from "react"

import {GithubOutlined} from "@ant-design/icons"
import {ArrowUpRight, ChatCircle, Clock, SquaresFour} from "@phosphor-icons/react"

const FEATURES = [
    {icon: <ChatCircle size={20} />, label: "Describe the work in chat"},
    {icon: <SquaresFour size={20} />, label: "Connect the apps you use"},
    {icon: <Clock size={20} />, label: "Run them in the background on a schedule or event"},
]

const SideBanner = () => {
    return (
        <section className="auth-panel hidden lg:flex flex-1 h-full flex-col justify-center p-24">
            <div className="flex flex-col gap-[26px] max-w-[520px]">
                <a
                    href="https://github.com/Agenta-AI/agenta"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="auth-chip self-start"
                >
                    <GithubOutlined style={{fontSize: 13}} />
                    <span>Open source · GitHub</span>
                    <ArrowUpRight size={13} weight="bold" />
                </a>

                <h2 className="auth-headline auth-headline-panel">
                    Build agents that automate your work
                </h2>

                <div className="flex flex-col">
                    {FEATURES.map((feature) => (
                        <div key={feature.label} className="auth-feature-row">
                            <span className="shrink-0">{feature.icon}</span>
                            <span>{feature.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

export default memo(SideBanner)
