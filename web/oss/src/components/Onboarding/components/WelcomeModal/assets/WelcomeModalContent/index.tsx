import {Typography} from "antd"

const WELCOME_VIDEO_URL = "https://www.youtube.com/embed/N3B_ZOYzjLg"

const WelcomeModalContent = () => {
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
