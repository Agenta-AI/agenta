import boto3


# Initialize the CloudWatch Logs client
client = boto3.client("logs")


def retrieve_cloudwatch_logs(function_app_id: str):
    log_group_name = f"/aws/lambda/app-{function_app_id}"

    # Describe log streams to get the newest log stream
    response = client.describe_log_streams(
        logGroupName=log_group_name,
        orderBy="lastEventTimestamp",
        descending=True,
        limit=1,
    )

    if "logStreams" in response and len(response["logStreams"]) > 0:
        newest_log_stream = response["logStreams"][0]["logStreamName"]

        # Get log events of the newest log stream
        log_events_response = client.get_log_events(
            logGroupName=log_group_name, logStreamName=newest_log_stream
        )
        if "events" in log_events_response:
            response_data = {}
            list_of_events_messages = []
            for event in log_events_response["events"]:
                list_of_events_messages.append(event["message"])

            response_data["message"] = "Log events found in the newest log stream"
            response_data["data"] = list_of_events_messages
            return response_data
        else:
            return "No log events found in the newest log stream"
    else:
        return "No log streams found in the log group."
