import {Button} from "@agenta/primitive-ui/components/button"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {Phone, SlackLogo} from "@phosphor-icons/react"
import Image from "next/image"
import Link from "next/link"

type Props = React.ComponentProps<typeof EnhancedModal> & {}

const MaxAppModal: React.FC<Props> = ({...props}) => {
    return (
        <EnhancedModal
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
                    <h4 className="text-base font-semibold leading-snug">
                        Hey, it seems like you have reached your free limit.{" "}
                    </h4>
                    <span>
                        To create more applications, please schedule a call to get full access to
                        the platform.
                    </span>
                    <span>Got any questions? Feel free to reach out to our support in Slack.</span>
                </div>

                <div className="flex items-center justify-end gap-2 mt-5">
                    <Button onClick={() => props.onCancel?.({} as any)} variant="outline">
                        Cancel
                    </Button>
                    <Link
                        href="https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw"
                        target="_blank"
                    >
                        <Button variant="outline">
                            {<SlackLogo size={14} className="mt-0.5" />}
                            Visit slack
                        </Button>
                    </Link>

                    <Link href="https://cal.com/mahmoud-mabrouk-ogzgey/30min" target="_blank">
                        <Button>
                            {<Phone size={14} className="mt-0.5" />}
                            Schedule a call
                        </Button>
                    </Link>
                </div>
            </section>
        </EnhancedModal>
    )
}

export default MaxAppModal
