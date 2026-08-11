import dynamic from "next/dynamic"
import {useRouter} from "next/router"

// Client-only: the AGENTS.md renderer pulls in katex's stylesheet, which Node can't parse
// during prerender.
const TemplateDetail = dynamic(
    () => import("@/oss/components/pages/agent-home/components/TemplateDetail"),
    {ssr: false},
)

/** One template in full, reached from the gallery. */
export default function TemplateDetailPage() {
    const {query} = useRouter()
    const templateKey = Array.isArray(query.template_key)
        ? query.template_key[0]
        : query.template_key

    return templateKey ? <TemplateDetail templateKey={templateKey} /> : null
}
