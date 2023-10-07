import {Modal, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"
import AppTemplateCard from "../AppTemplateCard"
import {Template} from "@/lib/Types"

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
        width: "100%",
        marginTop: 20,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))",
        gap: 20,
    },
    row: {
        marginTop: 20,
    },
})

const {Title} = Typography

type Props = React.ComponentProps<typeof Modal> & {
    newApp: string
    templates: Template[]
    noTemplateMessage: string
    onCardClick: (template: Template) => void
}

const AddAppFromTemplatedModal: React.FC<Props> = ({
    newApp,
    templates,
    noTemplateMessage,
    onCardClick,
    ...props
}) => {
    const classes = useStyles()

    return (
        <Modal
            data-cy="choose-template-modal"
            rootClassName={classes.modal}
            centered
            footer={null}
            title={
                <Title level={4} className={classes.title}>
                    Choose template
                </Title>
            }
            width={templates.length <= 1 || !!noTemplateMessage ? 620 : 900}
            {...props}
        >
            <div className={classes.body}>
                {noTemplateMessage ? (
                    <div>
                        <AppTemplateCard
                            title="No Templates Available"
                            body={noTemplateMessage}
                            noTemplate={true}
                            onClick={() => {}}
                        />
                    </div>
                ) : (
                    templates.map((template) => (
                        <div key={template.id}>
                            <AppTemplateCard
                                title={template.image.title}
                                body={template.image.description}
                                noTemplate={false}
                                onClick={() => {
                                    onCardClick(template)
                                }}

                                // commented to remove the tag amd64 tag
                                // tag={template.image.architecture}
                            />
                        </div>
                    ))
                )}
            </div>
        </Modal>
    )
}

export default AddAppFromTemplatedModal
