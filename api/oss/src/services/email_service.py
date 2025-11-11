import os
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from fastapi import HTTPException

from oss.src.utils.env import env


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
    Send an email via SMTP.

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

    # Create message
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = from_email
    message["To"] = to_email
    
    # Create HTML part
    html_part = MIMEText(html_content, "html")
    message.attach(html_part)
    
    try:
        await aiosmtplib.send(
            message,
            hostname=env.SMTP_HOST,
            port=env.SMTP_PORT,
            username=env.SMTP_USERNAME,
            password=env.SMTP_PASSWORD,
            use_tls=env.SMTP_USE_TLS,
        )
        return True
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SMTP Error: {str(e)}")
