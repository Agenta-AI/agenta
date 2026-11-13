class InstanceMissing(Exception):
    def __init__(self, message: str = "The instances row is missing. Run migrations."):
        self.message = message
        super().__init__(message)
