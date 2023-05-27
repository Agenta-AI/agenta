import React from 'react';
import { Col, Row } from 'antd';
import TestView from './Views/TestView';
import ParametersView from './Views/ParametersView';
import { useVariant } from '@/lib/hooks/useVariant';
import { Variant } from '@/lib/Types';
import { useRouter } from 'next/router';

const ViewNavigation: React.FC<Variant> = ({ variant }) => {
    const router = useRouter();
    const { app_name } = router.query;
    const { inputParams, optParams, URIPath, isLoading, isError, error, saveOptParams } = useVariant(app_name, variant);


    if (isLoading) {
        return <div>Loading...</div>;
    }
    if (isError) {
        let variantDesignator = variant.variantTemplate;
        let imageName = `agenta-server/${app_name.toLowerCase()}_`;

        if (!variantDesignator || variantDesignator === '') {
            variantDesignator = variant.variantName;
            imageName += variantDesignator.toLowerCase();
        } else {
            imageName += variantDesignator.toLowerCase();
        }

        const apiAddress = `localhost/${app_name}/${variantDesignator}/openapi.json`;

        return (
            <div>
                {error
                    ? <div>
                        <p>Error connecting to the variant {variant.variantName}. {error.message}</p>
                        <p>To debug this issue, please follow the steps below:</p>
                        <ul>
                            <li>Verify whether the API is up by checking if {apiAddress} is accessible.</li>
                            <li>Check if the Docker container for the variant {variantDesignator} is running. The image should be called {imageName}.</li>
                        </ul>
                        <p> In case the docker container is not running. Please simply start it (using cli or docker desktop)</p>
                        <p> If the issue persists please file an issue in github or directly contact us under team@agenta.ai</p>
                    </div>
                    : null
                }
            </div>
        );
    }

    return (
        <div style={{ margin: '10px' }}>
            <Row gutter={[{ xs: 8, sm: 16, md: 24, lg: 32 }, 20]}>
                <Col span={24}>
                    <ParametersView optParams={optParams} onOptParamsChange={saveOptParams} />
                </Col>
            </Row>
            <Row gutter={[{ xs: 8, sm: 16, md: 24, lg: 32 }, 20]} style={{ marginTop: '20px' }}>
                <Col span={24}>
                    <TestView inputParams={inputParams} optParams={optParams} URIPath={URIPath} />
                </Col>
            </Row>
        </div>);
};

export default ViewNavigation;

