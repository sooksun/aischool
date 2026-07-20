import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import MAX_BODY_BYTES, create_app


API_KEY = "a" * 64
AUTH = {"Authorization": f"Bearer {API_KEY}"}
PROMPT = {"prompt": {"1": {"class_type": "TestNode", "inputs": {}}}}


def make_client(handler):
    transport = httpx.MockTransport(handler)
    app = create_app(
        api_key=API_KEY,
        upstream_url="http://comfyui:8188",
        transport=transport,
    )
    return TestClient(app)


def test_missing_key_is_rejected_without_upstream_call():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={})

    with make_client(handler) as client:
        response = client.post("/external-api/v1/prompt", json=PROMPT)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert calls == []


def test_wrong_key_is_rejected_without_upstream_call():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={})

    with make_client(handler) as client:
        response = client.post(
            "/external-api/v1/prompt",
            headers={"Authorization": "Bearer wrong"},
            json=PROMPT,
        )
    assert response.status_code == 401
    assert calls == []


def test_valid_prompt_is_forwarded_without_authorization_header():
    observed = {}

    def handler(request):
        observed["method"] = request.method
        observed["path"] = request.url.path
        observed["authorization"] = request.headers.get("authorization")
        observed["json"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"prompt_id": "prompt-123", "number": 1, "node_errors": {}},
        )

    with make_client(handler) as client:
        response = client.post(
            "/external-api/v1/prompt", headers=AUTH, json=PROMPT
        )
    assert response.status_code == 200
    assert response.json()["prompt_id"] == "prompt-123"
    assert observed == {
        "method": "POST",
        "path": "/prompt",
        "authorization": None,
        "json": PROMPT,
    }


@pytest.mark.parametrize(
    ("headers", "body", "status"),
    [
        ({**AUTH, "Content-Type": "text/plain"}, b"{}", 415),
        ({**AUTH, "Content-Type": "application/json"}, b"not-json", 422),
        ({**AUTH, "Content-Type": "application/json"}, b"{}", 422),
        (
            {**AUTH, "Content-Type": "application/json"},
            json.dumps({"prompt": []}).encode(),
            422,
        ),
    ],
)
def test_invalid_requests_are_rejected(headers, body, status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={})

    with make_client(handler) as client:
        response = client.post(
            "/external-api/v1/prompt", headers=headers, content=body
        )
    assert response.status_code == status
    assert calls == []


def test_oversized_request_is_rejected():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={})

    body = b"{" + (b"x" * MAX_BODY_BYTES) + b"}"
    with make_client(handler) as client:
        response = client.post(
            "/external-api/v1/prompt",
            headers={**AUTH, "Content-Type": "application/json"},
            content=body,
        )
    assert response.status_code == 413
    assert calls == []


def test_prompt_timeout_maps_to_504():
    def handler(request):
        raise httpx.ReadTimeout("upstream timeout", request=request)

    with make_client(handler) as client:
        response = client.post(
            "/external-api/v1/prompt", headers=AUTH, json=PROMPT
        )
    assert response.status_code == 504


def test_health_reports_upstream_state():
    def healthy(request):
        assert request.url.path == "/system_stats"
        assert request.headers.get("authorization") is None
        return httpx.Response(200, json={"system": {}})

    with make_client(healthy) as client:
        response = client.get("/external-api/v1/health", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "upstream": "healthy"}

    def unhealthy(request):
        raise httpx.ConnectError("unavailable", request=request)

    with make_client(unhealthy) as client:
        response = client.get("/external-api/v1/health", headers=AUTH)
    assert response.status_code == 503
    assert response.json() == {"detail": "ComfyUI is unavailable"}


def test_unlisted_route_does_not_reach_upstream():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={})

    with make_client(handler) as client:
        response = client.get("/external-api/v1/history", headers=AUTH)
    assert response.status_code == 404
    assert calls == []
