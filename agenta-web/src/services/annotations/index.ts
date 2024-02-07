import axios from "@/lib//helpers/axiosConfig"
import {AnnotationScenario, EvaluationStatus, _Annotation} from "@/lib/Types"
import {EvaluationType} from "@/lib/enums"

export const fetchAllAnnotations = async (appId: string) => {
    const response = await axios.get(`/api/human-evaluations/`, {params: {app_id: appId}})
    return response.data
}

export const fetchAnnotation = async (annotationId: string) => {
    const response = await axios.get(`/api/human-evaluations/${annotationId}/`)
    return response.data
}

export const fetchAnnotationStatus = async (annotationId: string) => {
    const response = await axios.get(`/api/human-evaluations/${annotationId}/status/`)
    return response.data as {status: EvaluationStatus}
}

export type CreateAnnotationData = {
    variant_ids: string[]
    testset_id: string
    status: string
    evaluation_type: EvaluationType.single_model_test | EvaluationType.human_a_b_testing
    inputs: string[]
}

export const createAnnotation = async (appId: string, annotation: CreateAnnotationData) => {
    return axios.post(`/api/human-evaluations/`, {...annotation, app_id: appId})
}

export const deleteAnnotations = async (annotationsIds: string[]) => {
    return axios.delete(`/api/human-evaluations/`, {data: {annotations_ids: annotationsIds}})
}

// Annotation Scenarios
export const fetchAllAnnotationScenarios = async (appId: string, annotationId: string) => {
    const [{data: annotationScenarios}, annotation] = await Promise.all([
        axios.get(`/api/human-evaluations/${annotationId}/annotation_scenarios/`, {
            params: {app_id: appId},
        }),
        fetchAnnotation(annotationId),
    ])

    annotationScenarios.forEach((scenario: AnnotationScenario) => {
        scenario.annotation = annotation
    })
    return annotationScenarios as AnnotationScenario[]
}

export const updateAnnotationScenario = async (
    annotationId: string,
    annotationScenarioId: string,
    data: Pick<AnnotationScenario, "is_pinned" | "note" | "result">,
) => {
    return axios.put(
        `/api/human-evaluations/${annotationId}/annotation_scenarios/${annotationScenarioId}`,
        data,
    )
}
