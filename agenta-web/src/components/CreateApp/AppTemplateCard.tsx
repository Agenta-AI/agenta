import {Card, Typography} from "antd"

interface Props {
    title: string
}

const AppTemplateCard: React.FC<Props> = ({title}) => {
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
        >
            <Text>{title}</Text>
        </Card>
    )
}

export default AppTemplateCard
