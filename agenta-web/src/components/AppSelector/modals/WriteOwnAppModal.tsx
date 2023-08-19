import {Modal, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"
import YouTube from "react-youtube"

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
        >
            <div className={classes.body}>
                <YouTube videoId="8-k1C6ehKuw" loading="lazy" />
            </div>
        </Modal>
    )
}

export default WriteOwnAppModal
