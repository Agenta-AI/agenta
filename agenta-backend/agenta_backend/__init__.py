import os

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    import agenta_backend.cloud.__init__
