import os

if os.environ.get("LICENSE") in ["cloud", "cloud-dev"]:
    import agenta_backend.cloud.__init__
if os.environ.get("LICENSE") in ["ee"]:
    import agenta_backend.ee.__init__
