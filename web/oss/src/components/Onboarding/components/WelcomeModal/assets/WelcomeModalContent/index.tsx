import {Typography} from "antd"

const WELCOME_VIDEO_URL = "https://www.youtube.com/embed/N3B_ZOYzjLg"

type WelcomeModalContentProps = {
    variant?: "default" | "sme"
}

const WelcomeModalContent = ({variant = "default"}: WelcomeModalContentProps) => {
    if (variant === "sme") {
        return (
            <div className="flex flex-col gap-2 mb-6 mt-5">
                <Typography.Paragraph className="font-bold">
                    Personalized onboarding
                </Typography.Paragraph>
                <Typography.Paragraph className="!mb-0 text-[#475467]">
                    We&apos;ll spin up a live online evaluation, walk through app creation, run a
                    few prompt experiments in the playground, and then jump straight into the
                    evaluation we created so you can see how live scoring works. It only takes a
                    couple of minutes.
                </Typography.Paragraph>
                <div className="rounded-lg border border-dashed border-[#D0D5DD] bg-[#F9FAFB] p-3">
                    <ul className="list-disc pl-5 text-[#475467] space-y-1">
                        <li>Auto-create a demo online evaluation powered by LLM-as-a-judge.</li>
                        <li>Follow the guided flow to create your first app.</li>
                        <li>Experiment in the playground and learn how to run tests.</li>
                        <li>Review the live evaluation</li>
                    </ul>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4 mb-10 mt-5">
            <div
                className="relative overflow-hidden rounded-lg bg-black"
                style={{paddingTop: "56.25%"}}
            >
                <iframe
                    src={WELCOME_VIDEO_URL}
                    title="Welcome to Agenta"
                    className="absolute left-0 top-0 h-full w-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                />
            </div>
            <Typography.Paragraph className="!mb-0">
                Welcome to Agenta Cloud! Our platform helps you build, deploy, and manage AI
                applications with ease. Take this quick 2-minute tour to discover how to create your
                first AI app, set up deployments, and monitor performance—all in one place. Or, feel
                free to skip and explore at your own pace.
            </Typography.Paragraph>
        </div>
    )
}

export default WelcomeModalContent
