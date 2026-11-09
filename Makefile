.PHONY: dev api web seed test test-api test-web e2e eval gen-api tour-payloads lint fmt clean

API_DIR=apps/api
WEB_DIR=apps/web

dev: ## run api + web (seeds canonical DB if missing)
	@$(MAKE) -j2 api web

api:
	cd $(API_DIR) && uv run torch seed --if-missing && uv run uvicorn torch_rcm.api.app:app --reload --port 8000

web:
	cd $(WEB_DIR) && pnpm dev --port 5173

seed: ## destroy and reseed the canonical scenario
	cd $(API_DIR) && uv run torch seed --force --scenario $${TORCH_SCENARIO:-canonical}

test: test-api test-web

test-api:
	cd $(API_DIR) && uv run pytest -q

test-web:
	cd $(WEB_DIR) && pnpm test -- --run

e2e: ## playwright demo script (expects make dev running)
	cd $(WEB_DIR) && pnpm e2e

eval: ## replay canonical scenario through deterministic + live(cassette) and compare run shapes
	cd $(API_DIR) && uv run torch eval

gen-api: ## regenerate the web client from the API's OpenAPI
	cd $(API_DIR) && uv run torch openapi --out openapi.snapshot.json
	cd $(WEB_DIR) && pnpm gen:api

tour-payloads: ## regenerate the onboarding tour's code panes (apps/web/src/features/tour/payloads) from the code
	cd $(API_DIR) && uv run python scripts/tour_payloads.py

lint:
	cd $(API_DIR) && uv run ruff check . && uv run ruff format --check . && uv run mypy torch_rcm
	cd $(WEB_DIR) && pnpm lint && pnpm typecheck

fmt:
	cd $(API_DIR) && uv run ruff format . && uv run ruff check --fix .
	cd $(WEB_DIR) && pnpm format

clean:
	rm -f $(API_DIR)/*.db
