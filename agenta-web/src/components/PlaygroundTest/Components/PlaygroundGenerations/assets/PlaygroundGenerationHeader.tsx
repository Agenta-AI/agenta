import {useState} from "react"
import {Play} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import PlaygroundLoadTestsetModal from "../../Modals/PlaygroundLoadTestsetModal"

const PlaygroundGenerationHeader = () => {
    const [testsetData, setTestsetData] = useState<Record<string, any> | null>(null)
    const [isTestsetModalOpen, setIsTestsetModalOpen] = useState(false)

    return (
        <section className="h-[48px] flex justify-between items-center gap-4 px-4 py-2 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
            <Typography className="text-[16px] leading-[18px] font-[600]">Generations</Typography>

            <div className="flex items-center gap-2">
                <Button size="small">Clear</Button>
                <Button size="small" onClick={() => setIsTestsetModalOpen(true)}>
                    Load Test set
                </Button>
                <Button size="small" type="primary" icon={<Play size={14} />}>
                    Run all
                </Button>
            </div>

            <PlaygroundLoadTestsetModal
                open={isTestsetModalOpen}
                onCancel={() => setIsTestsetModalOpen(false)}
                testsetData={testsetData}
                setTestsetData={setTestsetData}
            />
        </section>
    )
}

export default PlaygroundGenerationHeader
