FROM python:3.12.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 comfyapi \
    && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin comfyapi

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY app.py /app/app.py
COPY tests /app/tests

EXPOSE 8000

CMD ["sh", "-ec", "export COMFY_API_KEY=\"$(tr -d '\\r\\n' < /run/secrets/comfy_api_key)\"; exec gosu comfyapi:comfyapi uvicorn app:app --host 0.0.0.0 --port 8000 --no-access-log"]
