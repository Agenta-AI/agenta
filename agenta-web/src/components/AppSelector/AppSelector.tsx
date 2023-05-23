// components/AppSelector.tsx
import { useContext, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Input, Row, Card, Col, Modal, Tag, Tooltip } from 'antd';
import AppContext from '@/contexts/appContext';
import useSWR from 'swr'

const fetcher = (...args) => fetch(...args).then(res => res.json())

const AppSelector = () => {
    const [newApp, setNewApp] = useState('');
    const { setApp } = useContext(AppContext);
    const router = useRouter();
    const [isModalOpen, setIsModalOpen] = useState(false);

    const showModal = () => {
        setIsModalOpen(true);
    };

    const handleOk = () => {
        setIsModalOpen(false);
        handleNavToApp(newApp);
    };

    const handleCancel = () => {
        setIsModalOpen(false);
    };

    const handleNavToApp = (appName: string) => {
        // add the newApp to your backend and update the state
        setApp(appName);
        // redirect to the main page
        router.push('/playground');
    }
    const [cards, setCards] = useState(["pitch_genius"]); // initial state with one card
    const { data, error, isLoading } = useSWR('http://localhost/api/app_variant/list_apps/', fetcher)
    if (error) return <div>failed to load</div>
    if (isLoading) return <div>loading...</div>


    return (
        <div style={{ margin: "50px 150px" }}>
            <Row gutter={10}> {/* gutter adds spacing between columns */}
                {data.map((app, index) => (
                    <Col key={index} span={6}>
                        <Button type="default" onClick={() => handleNavToApp(app.app_name)} style={{ height: '200px', width: '220px' }}>
                            <h3 style={{ fontWeight: 'bold' }}>{`${app.app_name}`}</h3>

                        </Button>
                    </Col>

                ))}
                <Col span={6}>
                    <Button type="default" onClick={showModal} style={{ height: '200px', width: '220px' }} disabled={true}>
                        <Tooltip placement="right" title="Currently, the only way to add new apps is through the CLI.">

                            <h3 style={{ fontWeight: 'bold' }}>New app</h3><Tag color="warning">soon</Tag>
                        </Tooltip>
                    </Button>
                </Col>
            </Row>
            <Modal title="Add new app from template" open={isModalOpen} onOk={handleOk} onCancel={handleCancel}>
                <Input
                    placeholder="New app name"
                    value={newApp}
                    onChange={(e) => setNewApp(e.target.value)}
                />
            </Modal>
        </div >

    );
};

export default AppSelector;
