import os

import sendgrid
from sendgrid.helpers.mail import Mail

from fastapi import HTTPException


# initialize sendgrid api client
sg = sendgrid.SendGridAPIClient(api_key=os.environ.get("SENDGRID_API_KEY"))


def read_email_template(template_file_path):
    """
    Function to read the HTML template from the file
    """

    # Get the absolute path to the template file
    script_directory = os.path.dirname(os.path.abspath(__file__))
    absolute_template_file_path = os.path.join(script_directory, template_file_path)

    with open(absolute_template_file_path, "r") as template_file:
        return template_file.read()


async def send_email(
    to_email: str, subject: str, html_content: str, from_email: str
) -> bool:
    """
    Send an email to a user.

    Args:
        to_email (str): The email address to send the email to.
        subject (str): The subject of the email.
        html_content (str): The HTML content of the email.
        from_email (str): The email address to send the email from.

    Returns:
        bool: True if the email was sent successfully, False otherwise.

    Raises:
        HTTPException: If there is an error sending the email.
    """

    message = Mail(
        from_email=from_email,
        to_emails=to_email,
        subject=subject,
        html_content=html_content,
    )

    try:
        sg.send(message)
        return True
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
