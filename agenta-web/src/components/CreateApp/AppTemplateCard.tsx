import {Card, Typography} from "antd"

interface Props {
    title: string
    onClick: () => void
    body: string
    noTemplate: boolean
}

const AppTemplateCard: React.FC<Props> = ({title, onClick, body, noTemplate}) => {
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
            <Text style={{
                marginTop: "0px",
            }}>{title}</Text>
           
           {noTemplate ? (
                <p>
                   {body} <a href="https://github.com/Agenta-AI/agenta/issues/new">here</a>.
                </p>
            ) : (
                <p>{body}</p>
            )}
        </Card>
    )
}

export default AppTemplateCard
