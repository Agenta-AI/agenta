import type {ReactNode} from "react"

import {Facebook, Github, Gitlab, Globe, Linkedin, Twitter} from "lucide-react"

/**
 * Provider glyphs from lucide's brand set; providers without one fall back to a globe.
 * Follow-up: a shared inline-SVG brand set in @agenta/auth-ui so desktop and mobile render
 * identical marks (desktop still uses @ant-design/icons in its page table).
 */
export const providerIcon = (id: string): ReactNode => {
    switch (id) {
        case "github":
            return <Github size={16} />
        case "gitlab":
            return <Gitlab size={16} />
        case "facebook":
            return <Facebook size={16} />
        case "linkedin":
            return <Linkedin size={16} />
        case "twitter":
            return <Twitter size={16} />
        default:
            return <Globe size={16} />
    }
}
