import os

if os.environ["FEATURE_FLAG"] in ["cloud", "cloud-dev"]:
    import agenta_backend.cloud.__init__
if os.environ["FEATURE_FLAG"] in ["ee"]:
    import agenta_backend.ee.__init__
