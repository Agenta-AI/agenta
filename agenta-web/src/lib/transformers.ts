import { AppEvaluationResponseType, Variant } from "./Types";
import { formatDate } from "./helpers/dateTimeHelper";

export const fromAppEvaluationResponseToAppEvaluation = (
  item: AppEvaluationResponseType,
) => {
  const variants: Variant[] = item.variants.map((variantName: string) => {
    const variant: Variant = {
      variantName: variantName,
      templateVariantName: null,
      persistent: true,
      parameters: null,
    };
    return variant;
  });

  return {
    id: item.id,
    createdAt: formatDate(item.created_at),
    variants: variants,
    dataset: item.dataset,
    appName: item.app_name,
    evaluationType: item.evaluation_type,
  };
};

export const fromEvaluationsRowsResponseToEvaluationsRows = (item: any) => {
  return {
    id: item.id,
    inputs: item.inputs,
    outputs: item.outputs,
    vote: item.vote,
    correctAnswer: item.correct_answer,
  };
};
