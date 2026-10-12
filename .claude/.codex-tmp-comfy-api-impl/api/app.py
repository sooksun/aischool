from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import secrets

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response


MAX_BODY_BYTES = 5 * 1024 * 1024
DEFAULT_UPSTREAM = "http://comfyui:8188"
DEFAULT_KEY_FILE = "/run/secrets/comfy_api_key"


def error(status_code: int, detail: str, authenticate: bool = False):
    headers = {"WWW-Authenticate": "Bearer"} if authenticate else None
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail},
        headers=headers,
    )


def read_key() -> str:
    from_environment = os.getenv("COMFY_API_KEY")
    if from_environment:
        return from_environment.strip()
    return Path(os.getenv("COMFY_API_KEY_FILE", DEFAULT_KEY_FILE)).read_text().strip()


def create_app(
    api_key: str | None = None,
    upstream_url: str = DEFAULT_UPSTREAM,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.api_key = api_key or read_key()
        if len(app.state.api_key) < 32:
            raise RuntimeError("API key must contain at least 32 characters")
        app.state.upstream = httpx.AsyncClient(
            base_url=upstream_url,
            transport=transport,
            timeout=httpx.Timeout(30.0, connect=5.0),
            follow_redirects=False,
        )
        yield
        await app.state.upstream.aclose()

    app = FastAPI(
        title="ComfyUI External API Gateway",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    def authenticated(request: Request) -> bool:
        scheme, separator, token = request.headers.get("authorization", "").partition(" ")
        return bool(
            separator
            and scheme.lower() == "bearer"
            and token
            and secrets.compare_digest(token, request.app.state.api_key)
        )

    async def require_auth(request: Request):
        if not authenticated(request):
            return error(401, "Invalid or missing Bearer token", authenticate=True)
        return None

    async def bounded_body(request: Request):
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
            return None, error(413, "Request body exceeds 5 MiB")
        chunks = bytearray()
        async for chunk in request.stream():
            if len(chunks) + len(chunk) > MAX_BODY_BYTES:
                return None, error(413, "Request body exceeds 5 MiB")
            chunks.extend(chunk)
        return bytes(chunks), None

    @app.post("/external-api/v1/prompt")
    async def submit_prompt(request: Request):
        unauthorized = await require_auth(request)
        if unauthorized:
            return unauthorized
        media_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
        if media_type != "application/json" and not media_type.endswith("+json"):
            return error(415, "Content-Type must be application/json")
        body, body_error = await bounded_body(request)
        if body_error:
            return body_error
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return error(422, "Request body must be valid JSON")
        if (
            not isinstance(payload, dict)
            or not isinstance(payload.get("prompt"), dict)
            or not payload["prompt"]
        ):
            return error(422, "prompt must be a non-empty JSON object")
        try:
            upstream = await request.app.state.upstream.post(
                "/prompt",
                content=body,
                headers={"Content-Type": "application/json"},
            )
        except httpx.TimeoutException:
            return error(504, "ComfyUI submission timed out")
        except httpx.HTTPError:
            return error(502, "ComfyUI gateway error")
        headers = {}
        if upstream.headers.get("content-type"):
            headers["Content-Type"] = upstream.headers["content-type"]
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            headers=headers,
        )

    @app.get("/external-api/v1/health")
    async def health(request: Request):
        unauthorized = await require_auth(request)
        if unauthorized:
            return unauthorized
        try:
            upstream = await request.app.state.upstream.get(
                "/system_stats", timeout=5.0
            )
        except httpx.HTTPError:
            return error(503, "ComfyUI is unavailable")
        if not 200 <= upstream.status_code < 300:
            return error(503, "ComfyUI is unavailable")
        return {"status": "ok", "upstream": "healthy"}

    return app


app = create_app()
