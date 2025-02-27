import os

if os.environ.get("FEATURE_FLAG") in ["cloud", "cloud-dev", "ee"]:
    import ee.src.__init__
