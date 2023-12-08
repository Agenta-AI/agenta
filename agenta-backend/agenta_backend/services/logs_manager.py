# Stdlib Imports
from typing import List, Union

# Third Party Imports
import boto3


# Initialize the CloudWatch Logs client
client = boto3.client("logs", region_name="eu-central-1")


def retrieve_cloudwatch_logs(function_deployment_name: str) -> Union[List[str], str]:
    """Retrieves the log events from the newest log stream of a
    specified CloudWatch log group associated with a Lambda function deployment.

    Args:
        - function_deployment_name: represents the name of the AWS Lambda function name

    Returns:
     - either a list of log event messages or a string indicating that no \
        log events or log streams were found.
    """

    log_group_name = f"/aws/lambda/{function_deployment_name}"
    response = client.describe_log_streams(
        logGroupName=log_group_name,
        orderBy="LastEventTime",
        descending=True,
        limit=1,
    )
    if "logStreams" in response and len(response["logStreams"]) > 0:
        newest_log_stream = response["logStreams"][0]["logStreamName"]
        log_events_response = client.get_log_events(
            logGroupName=log_group_name, logStreamName=newest_log_stream
        )
        if "events" in log_events_response:
            list_of_events_messages = []
            for event in log_events_response["events"]:
                list_of_events_messages.append(event["message"])
            return list_of_events_messages
        else:
            return "No log events found in the newest log stream"
    else:
        return "No log streams found in the log group"
