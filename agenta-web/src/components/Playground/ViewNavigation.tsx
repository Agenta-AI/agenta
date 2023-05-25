import React from 'react';
import { Tabs } from 'antd';
import TestView from './Views/TestView';
import LogsView from './Views/LogsView';
import ParametersView from './Views/ParametersView';
import { useVariant } from '@/hooks/useVariant';
import AppContext from '@/contexts/appContext';
const { TabPane } = Tabs;

interface ViewNavigationProps {
    variant: { variant_name: string };
}

const ViewNavigation: React.FC<ViewNavigationProps> = ({ variant }) => {
    const { app } = React.useContext(AppContext);
    const { inputParams, optParams, URIPath, isLoading, isError, error, saveOptParams } = useVariant(app, variant.variant_name);


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
        <Tabs defaultActiveKey="1">
            <TabPane tab="Parameters" key="1">
                <ParametersView optParams={optParams} onOptParamsChange={saveOptParams} />
            </TabPane>
            <TabPane tab="Test" key="2">
                <TestView inputParams={inputParams} optParams={optParams} URIPath={URIPath} />
            </TabPane>
            <TabPane tab="Logs" key="3">
                <LogsView />
            </TabPane>
        </Tabs>
    );
};

export default ViewNavigation;

