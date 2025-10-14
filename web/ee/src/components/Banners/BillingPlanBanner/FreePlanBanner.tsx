import {memo} from "react"

import {Button, Typography} from "antd"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

const FreePlanBanner = () => {
    const router = useRouter()
    const {projectURL} = useURL()

    return (
        <section className="p-4 rounded-lg flex flex-col gap-2 bg-[#F5F7FA]">
            <Typography.Text className="text-xl font-semibold">Free Plan</Typography.Text>
            <Typography.Text className="text-[#586673]">
                Create unlimited applications & run unlimited evaluations. Upgrade today and get
                more out of Agenta.{" "}
            </Typography.Text>
            <Button
                onClick={() => router.push(`${projectURL || ""}/settings?tab=billing`)}
                className="self-start"
            >
                Upgrade
            </Button>
        </section>
    )
}

export default memo(FreePlanBanner)
