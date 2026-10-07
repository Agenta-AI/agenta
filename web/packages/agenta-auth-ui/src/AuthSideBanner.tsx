/**
 * The product panel beside the sign-in form on wide viewports: the open-source pill, the
 * headline, and a live mock of the Automations page. It hides itself below `lg`; the phone layout
 * is the form alone.
 *
 * Styles come from auth.css (`.auth-panel`, `.auth-chip`), so the panel needs no props — only
 * the surrounding `.auth-redesign` scope.
 */
import {memo} from "react"

import {GithubLogo} from "@phosphor-icons/react"

import {ProductPreview} from "./ProductPreview"

const AuthSideBanner = () => (
    <section className="auth-panel m-3 hidden min-w-0 flex-1 flex-col gap-[clamp(24px,4vh,40px)] overflow-hidden rounded-lg pl-[clamp(32px,5vw,72px)] pt-[clamp(32px,8vh,72px)] lg:flex">
        <div className="flex flex-col gap-3.5 pr-8">
            <a
                href="https://github.com/Agenta-AI/agenta"
                target="_blank"
                rel="noopener noreferrer"
                className="auth-chip self-start"
            >
                <GithubLogo size={14} weight="fill" />
                <span>Open Source</span>
            </a>
            <h2 className="auth-headline auth-headline-panel m-0 max-w-[520px]">
                Agents that run while you work on something else
            </h2>
        </div>
        <div className="relative min-h-0 flex-1" aria-hidden>
            <div className="auth-preview-frame absolute left-0 top-0 h-[760px] w-[920px] overflow-hidden rounded-[14px]">
                <ProductPreview />
            </div>
        </div>
    </section>
)

export default memo(AuthSideBanner)
