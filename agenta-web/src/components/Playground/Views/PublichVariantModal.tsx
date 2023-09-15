import axios from "@/lib/helpers/axiosConfig"
import {fetchData} from "@/lib/services/api"
import {Button, Checkbox, Modal, Space, Typography, message} from "antd"
import type {CheckboxChangeEvent} from "antd/es/checkbox"
import {useRouter} from "next/router"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    buttonContainer: {
        display: "flex",
        justifyContent: "flex-end",
        columnGap: 8,
    },
})

interface Environment {
    name: string
    deployed_app_variant: string
}

interface Props {
    variantName: string
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
}

const PublishVariantModal: React.FC<Props> = ({variantName, isModalOpen, setIsModalOpen}) => {
    const classes = useStyles()
    const closeModal = () => {
        setIsModalOpen(false)
        setSelectedEnvs([])
    }
    const router = useRouter()
    const appName = router.query.app_name?.toString() || ""

    const [selectedEnvs, setSelectedEnvs] = useState<string[]>([])

    const handleChange = (e: CheckboxChangeEvent) => {
        if (!e.target.name) return

        setSelectedEnvs(
            e.target.checked
                ? [...selectedEnvs, e.target.name]
                : selectedEnvs.filter((env) => env !== e.target.name),
        )
    }

    const publishVariants = async () => {
        selectedEnvs.forEach((envName) => publishVariant(envName))
    }

    const publishVariant = async (environmentName: string) => {
        await axios.post(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/environments/deploy/?app_name=${appName}&variant_name=${variantName}&environment_name=${environmentName}`,
        )
        closeModal()
        fetchEnvironments()
        message.success(`Published ${variantName} to ${environmentName}`)
    }

    const [envOptions, setEnvOptions] = useState<Environment[]>([])
    const fetchEnvironments = async () => {
        const response: Environment[] = await fetchData(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/environments/?app_name=${appName}`,
        )
        setEnvOptions(
            response.map((env) => ({
                name: env.name,
                deployed_app_variant: env.deployed_app_variant,
            })),
        )
    }
    useEffect(() => {
        fetchEnvironments()
    }, [appName])

    return (
        <Modal
            title="Publish Variant"
            open={isModalOpen}
            onCancel={closeModal}
            footer={null}
            centered
        >
            <Space direction="vertical" size="middle" style={{display: "flex"}}>
                <Typography>
                    Select the environments where you would like to publish this variant.
                </Typography>

                {envOptions.map((env) =>
                    env.deployed_app_variant === variantName ? (
                        <Checkbox key={env.name} indeterminate disabled>
                            {env.name} (already published)
                        </Checkbox>
                    ) : (
                        <Checkbox key={env.name} name={env.name} onChange={handleChange}>
                            {env.name}
                        </Checkbox>
                    ),
                )}

                <div className={classes.buttonContainer}>
                    <Button onClick={closeModal}>Cancel</Button>
                    <Button type="primary" onClick={publishVariants}>
                        Publish
                    </Button>
                </div>
            </Space>
        </Modal>
    )
}

export default PublishVariantModal
