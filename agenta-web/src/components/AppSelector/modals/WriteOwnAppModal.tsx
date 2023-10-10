import CopyButton from "@/components/CopyButton/CopyButton"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {Modal, Typography} from "antd"
import React, {useEffect, useRef} from "react"
import {createUseStyles} from "react-jss"
import YouTube, {YouTubeProps} from "react-youtube"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    modal: {
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
    },
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
    },
    copyBtn: ({themeMode}: StyleProps) => ({
        border: "none",
        backgroundColor: "transparent",
        alignSelf: "flex-start",
        color: themeMode === "light" ? "#389e0d" : "#d89614",
        width: "auto !important",
        height: "auto !important",
    }),
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
        backgroundColor: themeMode === "light" ? "#f6ffed" : "#2b2111",
        padding: "3px 10px",
        borderRadius: 5,
        border: `1px solid ${themeMode === "light" ? "#389e0d" : "#d89614"}`,
        color: themeMode === "light" ? "#389e0d" : "#d89614",
        "& span": {
            letterSpacing: 0.3,
        },
    }),
    youtube: {
        "& iframe": {
            height: 410,
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
                    <div className={classes.container}>
                        <li>Clone agenta’s repo</li>
                        <div className={classes.command}>
                            <span>git clone https://github.com/Agenta-AI/agenta.git</span>
                            <CopyButton
                                text="git clone https://github.com/Agenta-AI/agenta.git"
                                icon={true}
                                buttonText={""}
                                className={classes.copyBtn}
                            />
                        </div>
                    </div>
                    <div className={classes.container}>
                        <li>Start Agenta</li>
                        <div className={classes.command}>
                            <span>docker compose up</span>
                            <CopyButton
                                text={"docker compose up"}
                                icon={true}
                                buttonText={""}
                                className={classes.copyBtn}
                            />
                        </div>
                    </div>
                    <div className={classes.container}>
                        <li>Checkout to your llm app folder</li>
                        <div className={classes.command}>
                            <span>cd your-llm-app-folder</span>
                            <CopyButton
                                text={"cd your-llm-app-folder"}
                                icon={true}
                                buttonText={""}
                                className={classes.copyBtn}
                            />
                        </div>
                    </div>
                    <div className={classes.container}>
                        <li>Create an llm app</li>
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
                        <li>Serve an app variant</li>
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
