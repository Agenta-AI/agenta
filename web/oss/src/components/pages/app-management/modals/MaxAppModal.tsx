import {Phone, SlackLogo} from "@phosphor-icons/react"
import {Button, Modal, Typography} from "antd"
import Image from "next/image"
import Link from "next/link"

type Props = React.ComponentProps<typeof Modal> & {}

const MaxAppModal: React.FC<Props> = ({...props}) => {
    return (
        <Modal
            rootClassName="[&_.ant-modal-content]:rounded-2xl [&_.ant-modal-close]:top-[17px]"
            centered
            footer={null}
            title="Unlock unlimited applications"
            width={480}
            {...props}
        >
            <section className="flex flex-col mt-4">
                <div className="bg-[linear-gradient(180deg,#1F2D43_0%,#3A547E_100%)] rounded-lg w-full h-[140px] flex items-center justify-center">
                    <Image
                        src="/assets/Agenta-logo-full-dark-accent.png"
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
                        To create more applications, please schedule a call to get full access to
                        the platform.
                    </Typography.Text>
                    <Typography.Text>
                        Got any questions? Feel free to reach out to our support in Slack.
                    </Typography.Text>
                </div>

                <div className="flex items-center justify-end gap-2 mt-5">
                    <Button onClick={() => props.onCancel?.({} as any)}>Cancel</Button>
                    <Link
                        href="https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw"
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
