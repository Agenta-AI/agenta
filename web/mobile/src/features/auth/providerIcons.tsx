import type {ReactNode} from "react"

import {
    FacebookLogo,
    GithubLogo,
    GitlabLogo,
    Globe,
    GoogleLogo,
    LinkedinLogo,
    XLogo,
} from "@phosphor-icons/react"

/** Provider glyphs from Phosphor's brand set; providers without one fall back to a globe. */
export const providerIcon = (id: string): ReactNode => {
    switch (id) {
        case "google":
            return <GoogleLogo size={16} />
        case "github":
            return <GithubLogo size={16} />
        case "gitlab":
            return <GitlabLogo size={16} />
        case "facebook":
            return <FacebookLogo size={16} />
        case "linkedin":
            return <LinkedinLogo size={16} />
        case "twitter":
            return <XLogo size={16} />
        default:
            return <Globe size={16} />
    }
}
