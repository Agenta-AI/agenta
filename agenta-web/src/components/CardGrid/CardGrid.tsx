import React, {useState} from "react"
import {Card, Button, Row, Col} from "antd"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    card: {
        width: 300,
        height: "250px",
        marginBottom: "20px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
    },
    cardBtn: {
        height: "200px",
        width: "220px",
    },
})

const CardGrid = () => {
    const classes = useStyles()
    const [cards, setCards] = useState([1]) // initial state with one card

    const addCard = () => {
        const newCard = cards.length + 1
        setCards([...cards, newCard])
    }

    return (
        <div>
            {" "}
            {/* Add padding here for spacing at sides */}
            <Row gutter={16}>
                {" "}
                {/* gutter adds spacing between columns */}
                {cards.map((card, index) => (
                    <Col key={index} span={6}>
                        {" "}
                        {/* each card takes 1/4 of the row */}
                        <Card className={classes.card}>
                            {card === cards.length ? ( // display + in the last card
                                <Button
                                    type="primary"
                                    onClick={addCard}
                                    className={classes.cardBtn}
                                >
                                    +
                                </Button>
                            ) : (
                                <div>{`App ${card}`}</div> // display app name
                            )}
                        </Card>
                    </Col>
                ))}
            </Row>
        </div>
    )
}

export default CardGrid
