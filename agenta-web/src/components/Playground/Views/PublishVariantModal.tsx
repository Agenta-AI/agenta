import {usePostHogAg} from "@/hooks/usePostHogAg"
import {Environment, Variant} from "@/lib/Types"
import {fetchEnvironments, publishVariant} from "@/lib/services/api"
import {Button, Checkbox, Modal, Space, Typography, message} from "antd"
import type {CheckboxChangeEvent} from "antd/es/checkbox"
import {useRouter} from "next/router"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"

const {Text} = Typography

const useStyles = createUseStyles({
    buttonContainer: {
        display: "flex",
        justifyContent: "flex-end",
        columnGap: 8,
    },
})

interface Props {
    variant: Variant
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
    environments: Environment[]
}

const PublishVariantModal: React.FC<Props> = ({
    variant,
    isModalOpen,
    setIsModalOpen,
    environments,
}) => {
    const classes = useStyles()
    const closeModal = () => {
        setIsModalOpen(false)
        setSelectedEnvs([])
    }
    const router = useRouter()
    const posthog = usePostHogAg()
    const appId = router.query.app_id as string

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
        selectedEnvs.forEach(async (envName) => {
            await publishVariant(variant.variantId, envName)
            closeModal()
            await loadEnvironments()
            message.success(`Published ${variant.variantName} to ${envName}`)
            posthog.capture("app_deployed", {app_id: appId, environment: envName})
        })
    }

    const [envOptions, setEnvOptions] = useState<Environment[]>([])
    const loadEnvironments = async () => {
        const response: Environment[] = await fetchEnvironments(appId)
        if (response.length === 0) return

        setEnvOptions(response)
    }
    useEffect(() => {
        setEnvOptions(environments)
    }, [environments])

    const checkboxElement = (env: Environment): JSX.Element => {
        if (!env.deployed_app_variant_id) {
            return (
                <Checkbox
                    key={env.name}
                    name={env.name}
                    checked={selectedEnvs.includes(env.name)}
                    onChange={handleChange}
                >
                    {env.name}
                </Checkbox>
            )
        }
        return (
            <Checkbox
                key={env.name}
                name={env.name}
                checked={selectedEnvs.includes(env.name)}
                onChange={handleChange}
            >
                {env.name} (
                <Text strong>
                    {env.deployed_variant_name}#{env.revision}
                </Text>{" "}
                is published in this environment)
            </Checkbox>
        )
    }

    return (
        <Modal
            title="Publish Variant"
            open={isModalOpen}
            onCancel={closeModal}
            footer={null}
            centered
        >
            <Space direction="vertical" size="middle" style={{display: "flex"}}>
                <Text>
                    Select the environments where you would like to publish this variant.
                    <br />
                    Deploying a new variant to an environment that already has an associated variant
                    will overwrite the existing one.
                </Text>

                {envOptions.map((env) => checkboxElement(env))}

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
