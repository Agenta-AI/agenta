import Image from "next/image"
import {Button, Modal, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"
import {Phone, SlackLogo} from "@phosphor-icons/react"
import Link from "next/link"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    modal: {
        "& .ant-modal-content": {
            borderRadius: 16,
        },
        "& .ant-modal-close": {
            top: 17,
        },
    },
    image: {
        background: "linear-gradient(180deg, #1F2D43 0%, #3A547E 100%)",
        borderRadius: theme.borderRadiusLG,
        width: "100%",
        height: 140,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
}))

type Props = React.ComponentProps<typeof Modal> & {}

const MaxAppModal: React.FC<Props> = ({...props}) => {
    const classes = useStyles()

    return (
        <Modal
            rootClassName={classes.modal}
            centered
            footer={null}
            title="Unlock unlimited applications"
            width={480}
            {...props}
        >
            <section className="flex flex-col mt-4">
                <div className={classes.image}>
                    <Image
                        src="/assets/dark-complete-transparent_white_logo.png"
                        alt="aenta-ai"
                        width={226}
                        height={60}
                    />
                </div>
                <div className="flex flex-col gap-4">
                    <Typography.Title level={4}>
                        Hey, it seems like you have reached your free limit.{" "}
                    </Typography.Title>
                    <Typography.Text>
                        To create more applications, please schedule a call to get full access to
                        the platform.
                    </Typography.Text>
                    <Typography.Text>
                        Got any questions? Feel free to reach out to our support in Slack.
                    </Typography.Text>
                </div>

                <div className="flex items-center justify-end gap-2 mt-5">
                    <Button onClick={() => props.onCancel?.({} as any)}>Cancel</Button>
                    <Link
                        href="https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA"
                        target="_blank"
                    >
                        <Button icon={<SlackLogo size={14} className="mt-0.5" />}>
                            Visit slack
                        </Button>
                    </Link>

                    <Link href="https://cal.com/mahmoud-mabrouk-ogzgey/30min" target="_blank">
                        <Button type="primary" icon={<Phone size={14} className="mt-0.5" />}>
                            Schedule a call
                        </Button>
                    </Link>
                </div>
            </section>
        </Modal>
    )
}

export default MaxAppModal
