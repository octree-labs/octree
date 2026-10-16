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

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/latex-compile .

# Copy cleanup script
COPY scripts/cleanup-logs.sh /app/scripts/cleanup-logs.sh
RUN chmod +x /app/scripts/cleanup-logs.sh

# Create logs directory
RUN mkdir -p /app/logs

# Set environment variables
ENV PORT=3001
ENV HISTORY_DIR=/app/logs
ENV GIN_MODE=release

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Run
CMD ["./latex-compile"]

