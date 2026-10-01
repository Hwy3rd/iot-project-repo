FROM python:3.10-slim

WORKDIR /app

# Prevent Python from writing .pyc files and enable unbuffered stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai_service.py .
COPY temperature_model_hgb.pkl .

EXPOSE 8000

CMD ["uvicorn", "ai_service:app", "--host", "0.0.0.0", "--port", "8000"]
