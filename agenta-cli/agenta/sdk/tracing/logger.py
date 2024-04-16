import logging


class LLMLogger:
    def __init__(self, name="LLMLogger", level=logging.INFO):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(level)

        # Add a stream logger to view the logs in the console
        console_handler = logging.StreamHandler()
        self.logger.addHandler(console_handler)

    @property
    def log(self) -> logging.Logger:
        return self.logger


# Initialize llm logger
llm_logger = LLMLogger().log
