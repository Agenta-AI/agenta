import dynamic from "next/dynamic"

const TemplatesGallery = dynamic(
    () => import("@/oss/components/pages/agent-home/components/TemplatesGallery"),
)

/** Full templates gallery reached from the agent onboarding Home. */
export default function TemplatesPage() {
    return <TemplatesGallery />
}
