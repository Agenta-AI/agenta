import {Modal, Typography} from "antd"
import React, {useEffect, useRef} from "react"
import {createUseStyles} from "react-jss"
import YouTube, {YouTubeProps} from "react-youtube"

const useStyles = createUseStyles({
    modal: {
        "& .ant-modal-close": {
            top: 23,
        },
    },
    title: {
        margin: 0,
    },
    body: {
        marginTop: 16,
        height: 360,
    },
})

const {Title} = Typography

type Props = React.ComponentProps<typeof Modal> & {}

const WriteOwnAppModal: React.FC<Props> = ({...props}) => {
    const classes = useStyles()
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
            width={688}
            {...props}
            afterClose={() => {
                if (youtubePlayer.current) {
                    youtubePlayer.current.getInternalPlayer().stopVideo()
                }
            }}
        >
            <YouTube
                videoId="nggaRwDZM-0"
                onStateChange={onPlayerReady}
                ref={(youtube) => {
                    youtubePlayer.current = youtube
                }}
            />
        </Modal>
    )
}

export default WriteOwnAppModal
