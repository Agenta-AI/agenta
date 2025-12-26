from typing import Dict, Union, Any


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],  # output of the llm app
    correct_answer: str,  # contains the testset row
) -> float:
    if output in correct_answer:
        return 1.0
    else:
        return 0.0
