import { Modal, Tooltip, Card } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { removeApp } from '@/lib/services/api';
import useSWR, { mutate } from 'swr';
import { useState } from 'react';
import Link from 'next/link';

const DeleteModal = ({ visible, handleOk, handleCancel, appName, confirmLoading }) => {
    return (
        <Modal
            title="Are you sure?"
            visible={visible}
            onOk={handleOk}
            confirmLoading={confirmLoading} // add this line
            onCancel={handleCancel}
            okText="Yes"
            cancelText="No"
        >
            <p>Are you sure you want to delete {appName}?</p>
        </Modal>
    );
};

const AppCard: React.FC<string> = ({ appName }) => {
    console.log("AppCard", appName);
    const [visibleDelete, setVisibleDelete] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);  // add this line
    const showDeleteModal = () => {
        setVisibleDelete(true);
    };

    const handleDeleteOk = async () => {
        setConfirmLoading(true); // add this line
        await removeApp(appName);
        setVisibleDelete(false);
        setConfirmLoading(false); // add this line
        mutate('http://localhost/api/app_variant/list_apps/');
    };

    const handleDeleteCancel = () => {
        setVisibleDelete(false);
    };

    return (
        <>

            <Card
                style={{
                    width: 300,
                    height: 120,
                    marginBottom: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    overflow: 'hidden' // add this line to ensure content doesn't overflow the card
                }}
                actions={[
                    <Tooltip title="Will be implemented soon">
                        <DeleteOutlined key="delete" style={{ color: 'red' }} onClick={showDeleteModal} />
                    </Tooltip>
                ]}
            ><Link href={`/apps/${appName}/playground`}>
                    <Card.Meta
                        style={{
                            height: '90%', // adjust this as needed
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        title={<div style={{ textAlign: 'center' }}>{appName}</div>}
                    /></Link>
            </Card>

            <DeleteModal
                visible={visibleDelete}
                handleOk={handleDeleteOk}
                handleCancel={handleDeleteCancel}
                appName={appName}
                confirmLoading={confirmLoading}
            />
        </>
    );
};

export default AppCard;