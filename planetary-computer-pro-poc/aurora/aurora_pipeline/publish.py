"""Publish the normalized events to the ``model-outputs`` container.

On Azure the job authenticates with its managed identity via
:class:`DefaultAzureCredential` (the same Storage Blob Data Contributor role the
web app uses). Locally, provide a full SAS URL instead.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from .config import Config


def publish_events(config: Config, events: list[dict]) -> str:
    payload = {
        "events": events,
        "generatedAtIso": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "analysisTimeIso": config.analysis_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "horizonHours": config.horizon_hours,
        "eventCount": len(events),
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    blob_client = _blob_client(config)
    from azure.storage.blob import ContentSettings

    blob_client.upload_blob(
        body,
        overwrite=True,
        content_settings=ContentSettings(content_type="application/json"),
    )
    return blob_client.url


def _blob_client(config: Config):
    from azure.storage.blob import BlobClient

    if config.output_sas_url:
        base, _, query = config.output_sas_url.partition("?")
        blob_url = f"{base.rstrip('/')}/{config.output_blob_name}"
        if query:
            blob_url = f"{blob_url}?{query}"
        return BlobClient.from_blob_url(blob_url)

    assert config.output_container_url is not None
    from azure.identity import DefaultAzureCredential

    blob_url = f"{config.output_container_url.rstrip('/')}/{config.output_blob_name}"
    return BlobClient.from_blob_url(blob_url, credential=DefaultAzureCredential())
