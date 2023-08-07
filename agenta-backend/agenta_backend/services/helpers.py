def print_app_variant(app_variant):
    print(f"App Variant ID: {app_variant.id}")
    print(f"App Variant Name: {app_variant.variant_name}")
    print(f"App Name: {app_variant.app_name}")
    print(f"Image ID: {app_variant.image_id}")
    print(f"Parameters: {app_variant.parameters}")
    print(f"Previous Variant Name: {app_variant.previous_variant_name}")
    print(f"Is Deleted: {app_variant.is_deleted}")
    print("------------------------")


def print_image(image):
    print(f"Image ID: {image.id}")
    print(f"Docker ID: {image.docker_id}")
    print(f"Tags: {image.tags}")
    print("------------------------")
