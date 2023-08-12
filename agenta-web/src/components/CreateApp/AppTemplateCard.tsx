import {Card, Typography} from "antd"

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
            onClick={onClick}
        >
            <Text>{title}</Text>
        </Card>
    )
}

export default AppTemplateCard
