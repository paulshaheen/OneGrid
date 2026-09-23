"""Publish the normalized events to the ``model-outputs`` container.

On Azure the job authenticates with its managed identity via
:class:`DefaultAzureCredential` (the same Storage Blob Data Contributor role the
web app uses). Locally, provide a full SAS URL instead.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from .config import Config

log = logging.getLogger("aurora_pipeline")


def publish_events(config: Config, events: list[dict]) -> str:
    blob_client = _blob_client(config)
    if not config.is_replay and not events and _recent_replay(blob_client, config.replay_pin_hours):
        log.info(
            "No storms in this scheduled cycle; keeping the historical replay published "
            "within the last %dh instead of overwriting it with an empty result.",
            config.replay_pin_hours,
        )
        return blob_client.url

    payload = {
        "events": events,
        "generatedAtIso": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "analysisTimeIso": config.analysis_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "horizonHours": config.horizon_hours,
        "eventCount": len(events),
        "replay": config.is_replay,
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    from azure.storage.blob import ContentSettings

    blob_client.upload_blob(
        body,
        overwrite=True,
        content_settings=ContentSettings(content_type="application/json"),
        metadata={"replay": "true" if config.is_replay else "false"},
    )
    return blob_client.url


def _recent_replay(blob_client, pin_hours: int) -> bool:
    """True when the current blob is a historical replay younger than ``pin_hours``."""
    from azure.core.exceptions import ResourceNotFoundError

    try:
        props = blob_client.get_blob_properties()
    except ResourceNotFoundError:
        return False
    if (props.metadata or {}).get("replay") != "true":
        return False
    return datetime.now(timezone.utc) - props.last_modified < timedelta(hours=pin_hours)


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
