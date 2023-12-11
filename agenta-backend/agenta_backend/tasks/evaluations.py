from celery import shared_task
import re


@shared_task(queue='agenta_backend.tasks.evaluations.auto_exact_match')
def auto_exact_match(variant_output, correct_answer):
    if variant_output == correct_answer:
        return 1
    else:
        return 0

@shared_task(queue='agenta_backend.tasks.evaluations.auto_similarity_match')
def auto_similarity_match(variant_output, correct_answer):
    set1 = set(variant_output.split())
    set2 = set(correct_answer.split())
    intersect = set1.intersection(set2)
    union = set1.union(set2)

    similarity = len(intersect) / len(union)
    return similarity

@shared_task(queue='agenta_backend.tasks.evaluations.auto_regex_test')
def auto_regex_test(test_string, regex, should_match):
    re_pattern = re.compile(regex, re.IGNORECASE)
    result = bool(re_pattern.search(test_string))
    return result == should_match



def evaluate(evaluate_name, correct_answer, variant_output, *additional_args, **additional_kwargs):
    module = __import__("agenta_backend.tasks.evaluations", fromlist=[evaluate_name])
    task_function = getattr(module, evaluate_name)

    task_function.delay(correct_answer, variant_output, *additional_args, **additional_kwargs)
