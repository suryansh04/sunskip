FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
# rasterio's bundled GDAL needs libexpat, which the slim image no longer ships
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Keep idle connections open longer than API Gateway reuses them: with uvicorn's default 5 s the gateway sometimes
# sends a request down a connection uvicorn is closing, and a POST then fails with 503 (GETs it retries quietly)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-keep-alive", "75"]
