// components/AppSelector.tsx
import { useContext, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Input, Row, Space, Col, Modal, Tag, Tooltip, Card } from 'antd';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons';
import useSWR from 'swr'
import Link from 'next/link';

const fetcher = (...args) => fetch(...args).then(res => res.json())

const AppSelector = () => {
    const [newApp, setNewApp] = useState('');
    const router = useRouter();
    const [isModalOpen, setIsModalOpen] = useState(false);

    const showModal = () => {
        setIsModalOpen(true);
    };

    const handleOk = () => {
        setIsModalOpen(false);
        // handleNavToApp(newApp);
    };

    const handleCancel = () => {
        setIsModalOpen(false);
    };

    const [cards, setCards] = useState(["pitch_genius"]); // initial state with one card
    const { data, error, isLoading } = useSWR('http://localhost/api/app_variant/list_apps/', fetcher)
    if (error) return <div>failed to load</div>
    if (isLoading) return <div>loading...</div>


    return (
        <div style={{ margin: "20px 20px" }}>
            <Space size={20} wrap direction='horizontal'>
                {data.map((app, index) => (
                    <Link key={index} href={`/apps/${app.app_name}/playground`}>
                        <Card
                            style={{
                                width: 300,
                                height: 105,
                                marginBottom: 24,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                overflow: 'hidden' // add this line to ensure content doesn't overflow the card
                            }}
                            actions={[
                                <Tooltip title="Will be implemented soon">
                                    <EditOutlined key="edit" style={{ color: 'grey' }} />
                                </Tooltip>,
                                <Tooltip title="Will be implemented soon">
                                    <DeleteOutlined key="delete" style={{ color: 'grey' }} />
                                </Tooltip>
                            ]}
                        >
                            <Card.Meta
                                style={{
                                    height: '90%', // adjust this as needed
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                                title={<div style={{ textAlign: 'center' }}>{app.app_name}</div>}
                            />
                        </Card>
                    </Link>
                ))}
                <Card
                    style={{
                        width: 300,
                        height: 105,
                        marginBottom: 24,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        opacity: 0.5,  // This gives the appearance of being disabled
                        pointerEvents: 'none',  // Prevents interactions with the card
                    }}
                >
                    <Tooltip placement="right" title="Currently, the only way to add new apps is through the CLI.">
                        <Card.Meta
                            style={{
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            title={
                                <div style={{ textAlign: 'center' }}>
                                    New app
                                    <Tag color="warning">soon</Tag>
                                </div>
                            }
                        />
                    </Tooltip>
                </Card>
                {/* <Button type="default" onClick={showModal} style={{ height: '200px', width: '220px' }} disabled={true}>
                    <Tooltip placement="right" title="Currently, the only way to add new apps is through the CLI.">

                        <h3 style={{ fontWeight: 'bold' }}>New app</h3><Tag color="warning">soon</Tag>
                    </Tooltip>
                </Button> */}
            </Space>
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
