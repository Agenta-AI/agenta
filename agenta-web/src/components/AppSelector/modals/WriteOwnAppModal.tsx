import Link from "next/link"
import CopyButton from "@/components/CopyButton/CopyButton"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {Modal, Typography} from "antd"
import React, {useEffect, useRef} from "react"
import {createUseStyles} from "react-jss"
import YouTube, {YouTubeProps} from "react-youtube"
import {isDemo} from "@/lib/helpers/utils"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    modal: ({themeMode}: StyleProps) => ({
        "& .ant-modal-content": {
            backgroundColor: themeMode === "dark" ? "rgb(13, 17, 23)" : "#fff",
        },
        "& .ant-modal-header": {
            backgroundColor: themeMode === "dark" ? "rgb(13, 17, 23)" : "#fff",
        },
        "& .ant-modal-close": {
            top: 23,
        },
        "& .ant-modal": {
            width: "auto !important",
        },
        "& .ant-modal-body": {
            display: "flex",
            alignItems: "center",
            gap: 10,
        },
    }),
    title: {
        margin: 0,
    },
    body: {
        marginTop: 16,
        height: 360,
    },
    wrapper: {
        width: 450,
        marginRight: 10,
        "& ol": {
            padding: "0 5px",
            listStyleType: "none",
        },
    },
    copyBtn: {
        backgroundColor: "transparent",
        alignSelf: "flex-start",
    },
    container: {
        margin: "20px 0",
        "& li": {
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 3,
        },
    },
    command: ({themeMode}: StyleProps) => ({
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: themeMode === "light" ? "#f6f8fa" : "#161b22",
        padding: "5px 10px",
        borderRadius: 5,
        border: `1px solid ${themeMode === "light" ? "#d0d7de" : "#30363d"}`,
        color: themeMode === "light" ? "#1f2328" : "#e6edf3",
        "& span": {
            letterSpacing: 0.3,
        },
    }),
    youtube: {
        "& iframe": {
            height: 430,
            width: 560,
        },
    },
})

const {Title} = Typography

type Props = React.ComponentProps<typeof Modal> & {}

const WriteOwnAppModal: React.FC<Props> = ({...props}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const youtubePlayer = useRef<YouTube | null>(null)

    const onPlayerReady: YouTubeProps["onStateChange"] = (event) => {
        if (!props.open) {
            event.target.pauseVideo()
        }
    }

    useEffect(() => {
        if (!props.open && youtubePlayer.current) {
            youtubePlayer.current.getInternalPlayer().pauseVideo()
        }
    }, [props.open])

    return (
        <Modal
            rootClassName={classes.modal}
            centered
            footer={null}
            title={
                <Title level={4} className={classes.title}>
                    Write your own app
                </Title>
            }
            {...props}
            afterClose={() => {
                if (youtubePlayer.current) {
                    youtubePlayer.current.getInternalPlayer().stopVideo()
                }
            }}
        >
            <div className={classes.wrapper}>
                <ol>
                    {isDemo() && (
                        <div className={classes.container}>
                            <li>
                                0. <Link href="/settings?tab=apiKeys">Get an API key</Link>
                            </li>
                        </div>
                    )}
                    <div className={classes.container}>
                        <li>1. Install agenta</li>
                        <div className={classes.command}>
                            <span>pip install -U agenta</span>
                            <CopyButton
                                text="pip install -U agenta"
                                icon={true}
                                buttonText={""}
                                className={classes.copyBtn}
                            />
                        </div>
                    </div>

                    <div className={classes.container}>
                        <li>2. Clone the example application</li>
                        <div className={classes.command}>
                            <span>git clone https://github.com/Agenta-AI/simple_prompt</span>
                            <CopyButton
                                text="git clone https://github.com/Agenta-AI/simple_prompt"
                                icon={true}
                                buttonText={""}
                                className={classes.copyBtn}
                            />
                        </div>
                    </div>
                    <div className={classes.container}>
                        <li>3. Set up environement variable</li>
                        <div className={classes.command}>
                            <span>echo "OPENAI_API_KEY=sk-xxx" `{">"}` .env</span>
                            <CopyButton
                                text={"echo 'OPENAI_API_KEY=sk-xxx' `{'>'}` .env<"}
                                icon={true}
                                buttonText={""}
                                className={classes.copyBtn}
                            />
                        </div>
                    </div>
                    <div className={classes.container}>
                        <li>4. Setup agenta (start from blank)</li>
                        <div className={classes.command}>
                            <span>agenta init</span>
                            <CopyButton
                                text={"agenta init"}
                                icon={true}
                                buttonText={""}
                                className={classes.copyBtn}
                            />
                        </div>
                    </div>
                    <div className={classes.container}>
                        <li>5. Serve an app variant</li>
                        <div className={classes.command}>
                            <span>agenta variant serve --file_name app.py</span>
                            <CopyButton
                                text={"agenta variant serve --file_name app.py"}
                                icon={true}
                                buttonText={""}
                                className={classes.copyBtn}
                            />
                        </div>
                    </div>
                    <span>
                        Check out{" "}
                        <a href="https://docs.agenta.ai/tutorials/your-first-llm-app">
                            our tutorial for writing your first LLM app
                        </a>
                    </span>
                </ol>
            </div>
            <YouTube
                videoId="nggaRwDZM-0"
                onStateChange={onPlayerReady}
                ref={(youtube) => {
                    youtubePlayer.current = youtube
                }}
                className={classes.youtube}
            />
        </Modal>
    )
}

export default WriteOwnAppModal
