import dynamic from "next/dynamic"
import {useRouter} from "next/router"

const TemplateDetail = dynamic(
    () => import("@/oss/components/pages/agent-home/components/TemplateDetail"),
)

/** One template in full, reached from the gallery. */
export default function TemplateDetailPage() {
    const {query} = useRouter()
    const templateKey = Array.isArray(query.template_key)
        ? query.template_key[0]
        : query.template_key

    return templateKey ? <TemplateDetail templateKey={templateKey} /> : null
}
