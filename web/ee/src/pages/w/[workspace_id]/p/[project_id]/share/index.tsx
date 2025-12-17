import {useEffect, useRef} from "react"

import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import ContentSpinner from "@/oss/components/Spinner/ContentSpinner"
import useURL from "@/oss/hooks/useURL"
import {EvaluationType} from "@/oss/lib/enums"
import {getAllVariantParameters} from "@/oss/lib/helpers/variantHelper"
import {GenericObject, Variant} from "@/oss/lib/Types"
import {createNewEvaluation} from "@/oss/services/human-evaluations/api"
import {useOrgData} from "@/oss/state/org"
import {variantsAtom} from "@/oss/state/variant/atoms/fetcher"

const EvaluationShare: React.FC = () => {
    const router = useRouter()
    const {changeSelectedOrg, selectedOrg, loading} = useOrgData()
    const called = useRef(false)
    const {baseAppURL} = useURL()

    useEffect(() => {
        const {app, org, variants: variantIds, testset, type} = router.query

        //1. check all the required params are present
        if (app && org && testset && type && Array.isArray(variantIds) && !loading) {
            const Executor = async () => {
                //make sure this is only called once
                if (called.current) {
                    return
                }
                called.current = true

                // variants from global store
                const allVariants = useAtomValue(variantsAtom)
                const variants = variantIds
                    .map((id) => allVariants.find((item) => item.variantId === id))
                    .filter((item) => item !== undefined) as Variant[]

                //get the inputs for each variant
                const results = await Promise.all(
                    variants.map((variant) =>
                        getAllVariantParameters(app as string, variant).then((data) => ({
                            variantName: variant.variantName,
                            inputs: data?.inputs.map((inputParam) => inputParam.name) || [],
                        })),
                    ),
                )
                const inputs: Record<string, string[]> = results.reduce(
                    (acc: GenericObject, result) => {
                        acc[result.variantName] = result.inputs
                        return acc
                    },
                    {},
                )

                //create the evaluation
                const evalId = await createNewEvaluation({
                    variant_ids: variantIds,
                    inputs: inputs[variants[0].variantName],
                    evaluationType: type as EvaluationType,
                    evaluationTypeSettings: {},
                    llmAppPromptTemplate: "",
                    selectedCustomEvaluationID: "",
                    testsetId: testset as string,
                })

                //redirect to the evaluation detail page once all work is done
                router.push(`${baseAppURL}/${app}/annotations/${type}/${evalId}`)
            }

            if (selectedOrg?.id !== org) {
                //2. change the selected org to the one in the query
                changeSelectedOrg(org as string, () => {
                    Executor()
                })
            } else {
                Executor()
            }
        }
    }, [router.query, loading])

    return <ContentSpinner />
}

export default () => <EvaluationShare />
