// components/ProjectSelector.tsx
import { useContext, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Input, Row, Card, Col, Modal } from 'antd';
import ProjectContext from '@/contexts/projectContext';
const ProjectSelector = () => {
    const [newProject, setNewProject] = useState('');
    const { setProject } = useContext(ProjectContext);
    const router = useRouter();
    const [isModalOpen, setIsModalOpen] = useState(false);

    const showModal = () => {
        setIsModalOpen(true);
    };

    const handleOk = () => {
        setIsModalOpen(false);
        handleNavToProject(newProject);
    };

    const handleCancel = () => {
        setIsModalOpen(false);
    };

    const handleNavToProject = (projectName: string) => {
        // add the newProject to your backend and update the state
        setProject(projectName);
        // redirect to the main page
        router.push('/playground');
    }
    const [cards, setCards] = useState(["pitch_genius"]); // initial state with one card

    const addCard = () => {
        const newCard = cards.length + 1;
        setCards([...cards, newCard]);
    };


    return (
        <div style={{ margin: "50px 150px" }}>
            <Row gutter={10}> {/* gutter adds spacing between columns */}
                {cards.map((card, index) => (
                    <Col key={index} span={6}>
                        <Button type="default" onClick={() => handleNavToProject(card)} style={{ height: '200px', width: '220px' }}>
                            <h3 style={{ fontWeight: 'bold' }}>{`${card}`}</h3>

                        </Button>
                    </Col>

                ))}
                <Col span={6}>
                    <Button type="default" onClick={showModal} style={{ height: '200px', width: '220px' }}>
                        <h3 style={{ fontWeight: 'bold' }}>New project</h3>

                    </Button>
                </Col>
            </Row>
            <Modal title="Add new project" open={isModalOpen} onOk={handleOk} onCancel={handleCancel}>
                <Input
                    placeholder="New project name"
                    value={newProject}
                    onChange={(e) => setNewProject(e.target.value)}
                />
            </Modal>
        </div >

    );
};

export default ProjectSelector;
