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

# Fonts documents ask for by name through fontspec (xelatex/lualatex). The
# font base image covers Latin, CJK and emoji; Arabic-script documents were
# failing after minutes (see below) because no Arabic font was installed.
# deploy.sh stops the running service before this image builds, so a flaky
# mirror must not fail the build: retry the index and package downloads.
RUN set -eux; \
    apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update; \
    apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 install -y --no-install-recommends \
        fonts-hosny-amiri \
        fonts-sil-scheherazade \
        fonts-noto-core; \
    rm -rf /var/lib/apt/lists/*; \
    fc-cache -f

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
# Never try to generate a missing font with Metafont: kpathsea otherwise runs
# mktextfm/mktexpk for every missing font on every page, which turned one
# 7-page document asking for an uninstalled font into a 4-minute run that
# still failed. With these off the engine reports the missing font at once.
ENV MKTEXTFM=0
ENV MKTEXPK=0
ENV MKTEXMF=0

USER compile

# Expose port (unprivileged, so no root needed to bind)
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Run
CMD ["./latex-compile"]
