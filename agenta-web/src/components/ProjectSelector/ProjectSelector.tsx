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
        handleAddProject();
    };

    const handleCancel = () => {
        setIsModalOpen(false);
    };

    const handleAddProject = () => {
        // add the newProject to your backend and update the state
        setProject(newProject);
        // redirect to the main page
        router.push('/playground');
    }
    const [cards, setCards] = useState([1]); // initial state with one card

    const addCard = () => {
        const newCard = cards.length + 1;
        setCards([...cards, newCard]);
    };


    return (
        <div>
            <Row gutter={16}> {/* gutter adds spacing between columns */}
                {cards.map((card, index) => (
                    <Col key={index} span={6}> {/* each card takes 1/4 of the row */}
                        <Card style={{
                            width: 300, height: '250px', marginBottom: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center'
                        }}>
                            {card === cards.length ? ( // display + in the last card
                                <Button type="primary" onClick={showModal} style={{ height: '200px', width: '220px' }}>
                                    New project
                                </Button>
                            ) : (
                                <div>{`Project ${card}`}</div> // display project name
                            )}
                        </Card>
                    </Col>))}
            </Row>
            <Modal title="Basic Modal" open={isModalOpen} onOk={handleOk} onCancel={handleCancel}>
                <Input
                    placeholder="New project name"
                    value={newProject}
                    onChange={(e) => setNewProject(e.target.value)}
                />
            </Modal>
        </div>

    );
};

export default ProjectSelector;
