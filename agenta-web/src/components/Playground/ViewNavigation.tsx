import React, {useEffect} from "react"
import {Col, Row, Divider, Button, Tooltip, Spin} from "antd"
import TestView from "./Views/TestView"
import ParametersView from "./Views/ParametersView"
import {useVariant} from "@/lib/hooks/useVariant"
import {Variant} from "@/lib/Types"
import {useRouter} from "next/router"
import {useState} from "react"
import {is} from "cypress/types/bluebird"
import useBlockNavigation from "@/hooks/useBlockNavigation"
import {useUpdateEffect} from "usehooks-ts"
import useStateCallback from "@/hooks/useStateCallback"
import {createUseStyles} from "react-jss"
import {getAppContainerURL} from "@/lib/services/api"

interface Props {
    variant: Variant
    handlePersistVariant: (variantName: string) => void
    setRemovalVariantName: (variantName: string) => void
    setRemovalWarningModalOpen: (value: boolean) => void
    isDeleteLoading: boolean
}

const useStyles = createUseStyles({
    row: {
        marginTop: "20px",
    },
})

const ViewNavigation: React.FC<Props> = ({
    variant,
    handlePersistVariant,
    setRemovalVariantName,
    setRemovalWarningModalOpen,
    isDeleteLoading,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appName = router.query.app_name as unknown as string
    const {
        inputParams,
        optParams,
        URIPath,
        isError,
        error,
        isParamSaveLoading,
        saveOptParams,
        isLoading,
        isChanged,
    } = useVariant(appName, variant)

    const [unSavedChanges, setUnSavedChanges] = useStateCallback(false)

    useBlockNavigation(unSavedChanges, {
        title: "Unsaved changes",
        message:
            "You have unsaved changes in your playground. Do you want to save these changes before leaving the page?",
        okText: "Save",
        onOk: async () => {
            await saveOptParams(optParams!, true, variant.persistent)
            return !!optParams
        },
        cancelText: "Proceed without saving",
    })

    useEffect(() => {
        if (isChanged) {
            setUnSavedChanges(true)
        }
    }, [optParams])

    const [isParamsCollapsed, setIsParamsCollapsed] = useState("1")
    const [containerURIPath, setContainerURIPath] = useState("")

    if (isError) {
        let variantDesignator = variant.templateVariantName
        let imageName = `agentaai/${appName.toLowerCase()}_`

        if (!variantDesignator || variantDesignator === "") {
            variantDesignator = variant.variantName
            imageName += variantDesignator.toLowerCase()
        } else {
            imageName += variantDesignator.toLowerCase()
        }

        const variantContainerPath = async () => {
            const urlPath = await getAppContainerURL(appName!, variantDesignator!)
            setContainerURIPath(urlPath)
        }
        if (!containerURIPath) {
            variantContainerPath()
        }

        const apiAddress = `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/${containerURIPath}/openapi.json`
        return (
            <div>
                {error ? (
                    <div>
                        <p>
                            Error connecting to the variant {variant.variantName}. {error.message}
                        </p>
                        <p>To debug this issue, please follow the steps below:</p>
                        <ul>
                            <li>
                                Verify whether the API is up by checking if {apiAddress} is
                                accessible.
                            </li>
                            <li>
                                Check if the Docker container for the variant {variantDesignator} is
                                running. The image should be called {imageName}.
                            </li>
                        </ul>
                        <p>
                            {" "}
                            In case the docker container is not running. Please check the logs from
                            docker to understand the issue. Most of the time it is a missing
                            requirements. Also, please attempt restarting it (using cli or docker
                            desktop)
                        </p>
                        <p>
                            {" "}
                            If the issue persists please file an issue in github here:
                            https://github.com/Agenta-AI/agenta/issues/new?title=Issue%20in%20ViewNavigation.tsx
                        </p>

                        <Button
                            type="primary"
                            danger
                            onClick={() => {
                                setRemovalVariantName(variant.variantName)
                                setRemovalWarningModalOpen(true)
                            }}
                            loading={isDeleteLoading}
                        >
                            <Tooltip placement="bottom" title="Delete the variant permanently">
                                Delete Variant
                            </Tooltip>
                        </Button>
                    </div>
                ) : null}
            </div>
        )
    }

    return (
        <Spin spinning={isLoading}>
            <Row gutter={[{xs: 8, sm: 16, md: 24, lg: 32}, 20]}>
                <Col span={24}>
                    <ParametersView
                        variantName={variant.variantName}
                        optParams={optParams}
                        isParamSaveLoading={isParamSaveLoading}
                        onOptParamsChange={saveOptParams}
                        handlePersistVariant={handlePersistVariant}
                        isPersistent={variant.persistent} // if the variant persists in the backend, then saveoptparams will need to know to update and not save new variant
                        setRemovalVariantName={setRemovalVariantName}
                        setRemovalWarningModalOpen={setRemovalWarningModalOpen}
                        isDeleteLoading={isDeleteLoading}
                        isParamsCollapsed={isParamsCollapsed}
                        setIsParamsCollapsed={setIsParamsCollapsed}
                        setUnSavedChanges={setUnSavedChanges}
                    />
                </Col>
            </Row>
            <Divider />

            <Row gutter={[{xs: 8, sm: 16, md: 24, lg: 32}, 20]} className={classes.row}>
                <Col span={24}>
                    <TestView inputParams={inputParams} optParams={optParams} URIPath={URIPath} />
                </Col>
            </Row>
        </Spin>
    )
}

export default ViewNavigation
