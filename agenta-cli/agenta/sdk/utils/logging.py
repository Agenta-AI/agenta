import logging


class Logger:
    def __init__(self, name="agenta.logger", level=logging.DEBUG):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(level)

        console_handler = logging.StreamHandler()
        self.logger.addHandler(console_handler)

    @property
    def log(self) -> logging.Logger:
        return self.logger


log = Logger().log
