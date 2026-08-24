"""Resolve the read/write blob *channel* URL the Aurora endpoint needs.

The endpoint streams initial conditions and predictions through an Azure blob
container, so it requires a container URL with a SAS token that has read and
write rights. Rather than making an operator hand-craft one in the portal, the
job can mint a short-lived user-delegation SAS with its own managed identity
(the same ``Storage Blob Data Contributor`` role the web app uses).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .config import Config

# User-delegation SAS lifetime. Long enough for a full multi-day rollout, short
# enough that a leaked URL expires quickly.
_SAS_HOURS = 6


def resolve_channel_url(config: Config) -> str:
    if config.blob_channel_url:
        return config.blob_channel_url

    assert config.blob_account_url and config.blob_container
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import (
        BlobServiceClient,
        ContainerSasPermissions,
        generate_container_sas,
    )

    account_url = config.blob_account_url.rstrip("/")
    service = BlobServiceClient(account_url, credential=DefaultAzureCredential())

    start = datetime.now(timezone.utc) - timedelta(minutes=5)
    expiry = start + timedelta(hours=_SAS_HOURS + 1)
    delegation_key = service.get_user_delegation_key(
        key_start_time=start, key_expiry_time=expiry
    )

    sas = generate_container_sas(
        account_name=service.account_name,
        container_name=config.blob_container,
        user_delegation_key=delegation_key,
        permission=ContainerSasPermissions(
            read=True, write=True, list=True, create=True, add=True
        ),
        start=start,
        expiry=expiry,
    )
    return f"{account_url}/{config.blob_container}?{sas}"
