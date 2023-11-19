import os

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    import agenta_backend.commons.__init__
