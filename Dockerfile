FROM python:3.12-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Set working directory
WORKDIR /app

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock* ./

# Install dependencies (no dev deps, no editable install)
RUN uv sync --frozen --no-dev --no-editable 2>&1

# Copy application source
COPY src/ ./src/
COPY frontend/ ./frontend/

# Ensure /data directory exists for SQLite volume mount
RUN mkdir -p /data

# Expose application port
EXPOSE 8000

# Run the FastAPI application
CMD ["uv", "run", "uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]

