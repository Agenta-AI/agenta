import React from 'react';
import { Col, Tabs, Row } from 'antd';
import TestView from './Views/TestView';
import LogsView from './Views/LogsView';
import ParametersView from './Views/ParametersView';
import { parseOpenApiSchema } from '@/lib/helpers/openapi_parser';
import { Parameter, fetchVariantParameters } from '@/lib/services/api'; // Import fetchVariantParameters() from api.ts
import { useVariant } from '@/lib/hooks/useVariant';
import AppContext from '@/contexts/appContext';
import { Variant } from './VersionTabs';
const { TabPane } = Tabs;

const ViewNavigation: React.FC<Variant> = ({ variant }) => {
    const { app } = React.useContext(AppContext);
    const { inputParams, optParams, URIPath, isLoading, isError, error, saveOptParams } = useVariant(app, variant);


    if (isLoading) {
        return <div>Loading...</div>;
    }
    if (isError) {
        return (
            <div>
                {error ? <div>Error: {error.message}</div> : null}
            </div>
        );
    }

    return (
        <>
            <Row gutter={20} style={{ margin: 10 }}>
                <Col span={12}>
                    <ParametersView optParams={optParams} onOptParamsChange={saveOptParams} />
                </Col>
                {/* </Row>
            <Row gutter={20} style={{ margin: 10, marginTop: 50 }}> */}
                <Col span={12}>
                    <TestView inputParams={inputParams} optParams={optParams} URIPath={URIPath} />
                </Col>
            </Row >
        </>
    );
};

export default ViewNavigation;

