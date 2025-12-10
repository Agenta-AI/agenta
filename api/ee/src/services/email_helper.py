import time

import requests

from oss.src.utils.env import env


def add_contact_to_loops(email, max_retries=5, initial_delay=1):
    """
    Add a contact to Loops audience with retry and exponential backoff.

    Args:
        email (str): Email address of the contact to be added.
        max_retries (int): Maximum number of retries in case of rate limiting.
        initial_delay (int): Initial delay in seconds before retrying.

    Raises:
        ConnectionError: If max retries reached and unable to connect to Loops API.

    Returns:
        requests.Response: Response object from the Loops API.
    """

    # Endpoint URL
    url = "https://app.loops.so/api/v1/contacts/create"

    # Request headers
    headers = {"Authorization": f"Bearer {env.loops.api_key}"}

    # Request payload/body
    data = {"email": email}

    retries = 0
    delay = initial_delay

    while retries < max_retries:
        # Making the POST request
        response = requests.post(url, json=data, headers=headers, timeout=20)

        # If response code is 429, it indicates rate limiting
        if response.status_code == 429:
            print(f"Rate limit hit. Retrying in {delay} seconds...")
            time.sleep(delay)
            retries += 1
            delay *= 2  # Double the delay for exponential backoff
        else:
            # If response is not 429, return it
            return response

    # If max retries reached, raise an exception or handle as needed
    raise ConnectionError("Max retries reached. Unable to connect to Loops API.")
