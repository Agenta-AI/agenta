import {Button, Card, Typography} from "antd"

interface Props {
    title: string
    onClick: () => void
}

const AppTemplateCard: React.FC<Props> = ({title, onClick}) => {
    const {Text} = Typography
    return (
        <Card
            style={{
                width: "210px",
                height: "160px",
                margin: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
            }}
            bodyStyle={{
                width: "100%",
                height: "100%",
                padding: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-evenly",
                flexDirection: "column",
            }}
        >
            <Text>{title}</Text>
            <Button onClick={onClick}>Create App</Button>
        </Card>
    )
}

export default AppTemplateCard
