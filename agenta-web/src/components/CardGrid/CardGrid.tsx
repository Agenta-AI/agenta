import React, { useState } from 'react';
import { Card, Button, Row, Col } from 'antd';

const CardGrid = () => {
    const [cards, setCards] = useState([1]); // initial state with one card

    const addCard = () => {
        const newCard = cards.length + 1;
        setCards([...cards, newCard]);
    };

    return (
        <div>  {/* Add padding here for spacing at sides */}
            <Row gutter={16}> {/* gutter adds spacing between columns */}
                {cards.map((card, index) => (
                    <Col key={index} span={6}> {/* each card takes 1/4 of the row */}
                        <Card style={{
                            width: 300, height: '250px', marginBottom: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center'
                        }}>
                            {card === cards.length ? ( // display + in the last card
                                <Button type="primary" onClick={addCard} style={{ height: '200px', width: '220px' }}>
                                    +
                                </Button>
                            ) : (
                                <div>{`Project ${card}`}</div> // display project name
                            )}
                        </Card>
                    </Col>))}
            </Row>
        </div>
    );
};

export default CardGrid;
