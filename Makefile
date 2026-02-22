.PHONY: help build run test lint clean dev install-tools frontend-build frontend-dev

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

frontend-build: ## Build the frontend
	cd frontend && npm install && npm run build

frontend-dev: ## Start frontend dev server
	cd frontend && npm run dev

build: frontend-build ## Build the application (frontend + Go binary)
	go build -o bin/gmail-triage-assistant cmd/server/main.go

run: ## Run the application
	go run cmd/server/main.go

dev: ## Run the application with hot reload (requires air)
	air

test: ## Run tests
	go test -v ./...

test-coverage: ## Run tests with coverage
	go test -v -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out

lint: ## Run linters
	golangci-lint run

fmt: ## Format code
	go fmt ./...

vet: ## Run go vet
	go vet ./...

clean: ## Clean build artifacts
	rm -rf bin/
	rm -f coverage.out
	rm -rf frontend/dist/

deps: ## Download dependencies
	go mod download
	go mod tidy

install-tools: ## Install development tools
	go install github.com/cosmtrek/air@latest
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

migrate-up: ## Run database migrations up
	@echo "Migration tool not yet implemented"

migrate-down: ## Run database migrations down
	@echo "Migration tool not yet implemented"
