ARG TEXLIVE_BASE_IMAGE=octree/texlive-runtime:2025

# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY main.go ./
COPY internal/ ./internal/

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o latex-compile .

# Runtime stage
FROM ${TEXLIVE_BASE_IMAGE}

ARG TEXLIVE_YEAR=2025

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/latex-compile .

# Copy cleanup script
COPY scripts/cleanup-logs.sh /app/scripts/cleanup-logs.sh
RUN chmod +x /app/scripts/cleanup-logs.sh

# The service runs LaTeX on untrusted input, so it must not run as root.
# A fixed UID keeps bind-mounted volumes (deployments/logs) chown-able from
# the host. The TeX Live base image points TEXMFHOME/TEXMFVAR/TEXMFCONFIG at
# /root; redirect them to the service user's home so font caches, format
# regeneration and luaotfload can still write, and seed that home with the
# caches the base image already built as root.
RUN set -eux; \
    groupadd --gid 10001 compile; \
    useradd --uid 10001 --gid compile --create-home --home-dir /home/compile --shell /usr/sbin/nologin compile; \
    mkdir -p /app/logs /home/compile/texmf /home/compile/.cache; \
    if [ -d "/root/.texlive${TEXLIVE_YEAR}" ]; then cp -a "/root/.texlive${TEXLIVE_YEAR}" /home/compile/; fi; \
    mkdir -p "/home/compile/.texlive${TEXLIVE_YEAR}/texmf-var" "/home/compile/.texlive${TEXLIVE_YEAR}/texmf-config"; \
    chown -R compile:compile /app /home/compile

# Set environment variables
ENV PORT=3001
ENV HISTORY_DIR=/app/logs
ENV GIN_MODE=release
ENV HOME=/home/compile
ENV TEXMFHOME=/home/compile/texmf
ENV TEXMFVAR=/home/compile/.texlive${TEXLIVE_YEAR}/texmf-var
ENV TEXMFCONFIG=/home/compile/.texlive${TEXLIVE_YEAR}/texmf-config

USER compile

# Expose port (unprivileged, so no root needed to bind)
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Run
CMD ["./latex-compile"]
