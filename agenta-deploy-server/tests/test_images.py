def test_get_images(test_app):
    response = test_app.get("/models/")
    print(response.json())
    assert response.status_code == 200


def test_start_model(test_app):
    model_name = "agenta-server/test"
    tag = "latest"
    response = test_app.post(
        '/models/start/', json={'tag': tag, 'model_name': model_name})

    assert response.status_code == 200

    # Add more assertions based on what you expect the response to be.
    # If the response is supposed to be a json with the container info, you can do:
    response_data = response.json()
    assert 'id' in response_data  # assuming your container object has an 'id' field
    # add more assertions based on your response structure
