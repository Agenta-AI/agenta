import {Button, Typography} from "antd"
import {useStyles} from "./styles"
import Version from "../../assets/Version"
import DeployButton from "../../assets/DeployButton"
import {ArrowCounterClockwise} from "@phosphor-icons/react"
import clsx from "clsx"

const PlaygroundVariantHistory = () => {
    const classes = useStyles()
    const lintOfRevisions = [2, 3, 5, 6, 7]
    const slectedRevision = 5

    return (
        <>
            <section className="flex justify-start items-center gap-2 px-4 py-2">
                <Button>Close</Button>
                <Typography className="text-[16px] leading-[18px] font-[600]">History</Typography>
            </section>

            <section className="flex justify-between gap-2 p-4">
                <aside className={classes.navigationContainer}>
                    {lintOfRevisions.map((revision) => (
                        <div
                            className={clsx(
                                classes.navigation,
                                revision === slectedRevision && classes.selectedNavigation, // for selected revision
                            )}
                            key={revision}
                        >
                            v{revision}
                        </div>
                    ))}
                </aside>

                <main className={classes.historyContainer}>
                    <div
                        className={clsx(
                            "flex items-center justify-between px-3 py-3",
                            classes.historyContainerHeader,
                        )}
                    >
                        <Version revision={slectedRevision} />

                        <div className="flex items-center gap-2">
                            <DeployButton label="Deploy" type="primary" />
                            <Button icon={<ArrowCounterClockwise size={14} />}>Revert</Button>
                        </div>
                    </div>
                </main>
            </section>
        </>
    )
}

export default PlaygroundVariantHistory
