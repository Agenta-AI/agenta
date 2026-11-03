import {Modal, Typography} from "antd"

import AvatarWithLabel from "../assets/AvatarWithLabel"

import {GenerateResetLinkModalProps} from "./assets/types"

const GenerateResetLinkModal = ({username, ...props}: GenerateResetLinkModalProps) => {
    return (
        <Modal
            title="Are you sure you want to generate reset password link?"
            okText="Generate Link"
            destroyOnHidden
            centered
            {...props}
        >
            <section className="flex flex-col gap-4">
                <Typography.Text>
                    You may only generate reset password link once per user.
                </Typography.Text>

                <div className="flex flex-col gap-1">
                    <Typography.Text>
                        You are about to generate reset password link for:
                    </Typography.Text>
                    <AvatarWithLabel name={username} />
                </div>
            </section>
        </Modal>
    )
}

export default GenerateResetLinkModal
