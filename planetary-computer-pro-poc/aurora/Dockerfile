# Aurora forecast pipeline — a light CPU job that builds initial conditions,
# calls the deployed Aurora (Foundry) GPU endpoint, tracks cyclones, and publishes
# weather-events.json. Runs on a schedule as an Azure Container Apps Job.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgomp1 is required by PyTorch; the eccodes/cfgrib wheels bundle their native libs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the CPU builds of torch AND torchvision together from the PyTorch CPU
# index (the model runs on the endpoint's GPU, not here). Pinning a matched pair is
# required: aurora -> timm pulls torchvision transitively, and a mismatched build
# fails at import with "operator torchvision::nms does not exist". Installing both
# here first satisfies that transitive dependency with the correct CPU build.
COPY requirements.txt ./
RUN pip install --index-url https://download.pytorch.org/whl/cpu \
        torch==2.5.1 torchvision==0.20.1 \
    && pip install -r requirements.txt

COPY aurora_pipeline ./aurora_pipeline

# The pipeline is a batch job: run one forecast cycle and exit.
ENTRYPOINT ["python", "-m", "aurora_pipeline.run"]
