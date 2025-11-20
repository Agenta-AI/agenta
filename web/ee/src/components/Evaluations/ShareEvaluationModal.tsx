import qs from "querystring"

import {Input, Modal, ModalProps, Typography} from "antd"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import CopyButton from "@/oss/components/CopyButton/CopyButton"
import {useOrgData} from "@/oss/contexts/org.context"
import {EvaluationType} from "@/oss/lib/enums"

const useStyles = createUseStyles({
    row: {
        marginTop: "1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
    },
    input: {
        pointerEvents: "none",
        color: "rgba(0, 0, 0, 0.45)",
        flex: 1,
    },
})

interface Props {
    variantIds: string[]
    testsetId: string
    evaluationType: EvaluationType
}

const ShareEvaluationModal: React.FC<ModalProps & Props> = ({...props}) => {
    const classes = useStyles()
    const {selectedOrg} = useOrgData()
    const router = useRouter()
    const appId = router.query.app_id as string

    const parmas = qs.stringify({
        type: props.evaluationType,
        testset: props.testsetId,
        variants: props.variantIds,
        app: appId,
        org: selectedOrg?.id,
    })
    const link = `${window.location.origin}/evaluations/share?${parmas}`

    return (
        <Modal footer={null} title="Invite Collaborators" {...props}>
            <Typography.Text>
                You can invite members of your organization to collaborate on this evaluation by
                sharing the link below.
            </Typography.Text>

            <div className={classes.row}>
                <Input type="text" value={link} className={classes.input} />
                <CopyButton text={link} icon type="primary" />
            </div>
        </Modal>
    )
}

export default ShareEvaluationModal
