FROM python:3.10-slim

WORKDIR /app

# Prevent Python from writing .pyc files and enable unbuffered stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai_service.py .
COPY temperature_model_hgb.pkl .

# Runs unprivileged; the app only reads its own files under /app.
RUN useradd --system --no-create-home --uid 10001 aiservice
USER aiservice

EXPOSE 8000

# /health answers 503 while the model isn't loaded, so a model that fails to
# load (e.g. a scikit-learn version mismatch) shows up as unhealthy. The slim
# image has no curl, hence urllib.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

CMD ["uvicorn", "ai_service:app", "--host", "0.0.0.0", "--port", "8000"]
