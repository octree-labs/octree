.PHONY: build run test clean docker-build docker-run help

# Variables
BINARY_NAME=latex-compile
DOCKER_IMAGE=octree/latex-compile
PORT?=3001

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build the binary
	@echo "Building..."
	go build -o $(BINARY_NAME) .
	@echo "Build complete: $(BINARY_NAME)"

run: ## Run the service locally
	@echo "Starting service on port $(PORT)..."
	PORT=$(PORT) go run .

test: ## Run tests
	go test -v ./...

clean: ## Clean build artifacts
	@echo "Cleaning..."
	rm -f $(BINARY_NAME)
	rm -rf logs/
	@echo "Clean complete"

deps: ## Download dependencies
	go mod download
	go mod tidy

docker-build: ## Build Docker image
	@echo "Building Docker image..."
	docker build -f deployments/Dockerfile -t $(DOCKER_IMAGE):latest .
	@echo "Docker image built: $(DOCKER_IMAGE):latest"

docker-run: ## Run Docker container
	@echo "Running Docker container..."
	docker run --rm \
		-p $(PORT):3001 \
		-v $(PWD)/logs:/app/logs \
		--name latex-compile \
		$(DOCKER_IMAGE):latest

docker-stop: ## Stop Docker container
	docker stop latex-compile

docker-compose-up: ## Start with docker-compose
	docker-compose -f deployments/docker-compose.yml up -d

docker-compose-down: ## Stop docker-compose
	docker-compose -f deployments/docker-compose.yml down

logs: ## Show logs
	tail -f logs/*.json

health: ## Check health endpoint
	@curl -s http://localhost:$(PORT)/health | jq .

test-compile: ## Test compilation with sample LaTeX
	@echo "Testing compilation..."
	@curl -X POST http://localhost:$(PORT)/compile \
		-H "Content-Type: application/json" \
		-d '{"projectId":"make-test","files":[{"path":"main.tex","content":"\\documentclass{article}\\begin{document}Hello from Octree!\\end{document}"}]}' \
		--output test-output.pdf && \
		echo "\nSuccess! PDF saved to test-output.pdf" || \
		echo "\nFailed to compile"

install-texlive: ## Install TexLive (macOS only)
	@echo "Installing TexLive via Homebrew..."
	brew install --cask mactex

lint: ## Run linters
	golangci-lint run

fmt: ## Format code
	go fmt ./...
	goimports -w .

vet: ## Run go vet
	go vet ./...

all: clean deps build ## Clean, download deps, and build

dev: ## Run in development mode with hot reload (requires air)
	air

