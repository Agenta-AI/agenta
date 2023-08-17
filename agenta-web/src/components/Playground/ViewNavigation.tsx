import React from "react"
import {Col, Row, Divider, Button, Tooltip} from "antd"
import TestView from "./Views/TestView"
import ParametersView from "./Views/ParametersView"
import {useVariant} from "@/lib/hooks/useVariant"
import {Variant} from "@/lib/Types"
import {useRouter} from "next/router"
import {useState} from "react"
import {is} from "cypress/types/bluebird"

interface Props {
    variant: Variant
    handlePersistVariant: (variantName: string) => void
    setRemovalVariantName: (variantName: string) => void
    setRemovalWarningModalOpen: (value: boolean) => void
    isDeleteLoading: boolean
}

const ViewNavigation: React.FC<Props> = ({
    variant,
    handlePersistVariant,
    setRemovalVariantName,
    setRemovalWarningModalOpen,
    isDeleteLoading,
}) => {
    const router = useRouter()
    const appName = router.query.app_name as unknown as string
    const {inputParams, optParams, URIPath, isError, error, isParamSaveLoading, saveOptParams} =
        useVariant(appName, variant)
    const [isParamsCollapsed, setIsParamsCollapsed] = useState("1")

    if (isError) {
        let variantDesignator = variant.templateVariantName
        let imageName = `agenta-server/${appName.toLowerCase()}_`

        if (!variantDesignator || variantDesignator === "") {
            variantDesignator = variant.variantName
            imageName += variantDesignator.toLowerCase()
        } else {
            imageName += variantDesignator.toLowerCase()
        }

        const apiAddress = `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/${appName}/${variantDesignator}/openapi.json`

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
                            size="normal"
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
        <div>
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
                    />
                </Col>
            </Row>
            <Divider />

            <Row gutter={[{xs: 8, sm: 16, md: 24, lg: 32}, 20]} style={{marginTop: "20px"}}>
                <Col span={24}>
                    <TestView inputParams={inputParams} optParams={optParams} URIPath={URIPath} />
                </Col>
            </Row>
        </div>
    )
}

export default ViewNavigation
