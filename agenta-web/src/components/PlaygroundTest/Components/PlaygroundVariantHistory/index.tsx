import {Menu} from "antd"
import {useStyles} from "./styles"
import clsx from "clsx"
import PlaygroundVariantHistoryHeader from "./assets/PlaygroundVariantHistoryHeader"

const PlaygroundVariantHistory = () => {
    const classes = useStyles()
    const lintOfRevisions = ["2", "3", "5", "6", "7"]
    const slectedRevision = "5"

    return (
        <>
            <PlaygroundVariantHistoryHeader slectedRevision={slectedRevision} />

            <section className="h-[94%] flex justify-between gap-2">
                <div className={clsx("pt-4 pl-2", classes.menuContainer)}>
                    <Menu
                        items={lintOfRevisions.map((revision) => ({
                            key: revision,
                            label: revision,
                        }))}
                        defaultSelectedKeys={[slectedRevision]}
                        className={clsx("w-[180px]", classes.menu)}
                    />
                </div>

                <main className={"p-4"}></main>
            </section>
        </>
    )
}

export default PlaygroundVariantHistory
