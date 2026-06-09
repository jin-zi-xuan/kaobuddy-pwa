PACKAGE_ID := $(shell awk -F': *' '/^package:/ {print $$2; exit}' package.yml)
VERSION := $(shell awk -F': *' '/^version:/ {print $$2; exit}' package.yml)
LPK_FILE ?= release-lpk/$(PACKAGE_ID)-v$(VERSION).lpk
LOCAL_IMAGE ?= kaobuddy-pwa:lazycat

.PHONY: all doctor lint docker-build-local smoke-image build install update release-prep clean

all: build

doctor:
	@command -v lzc-cli >/dev/null || (echo "Error: lzc-cli not installed" && exit 1)
	@command -v docker >/dev/null || (echo "Error: Docker not installed" && exit 1)
	@docker buildx version >/dev/null || (echo "Error: docker buildx not available" && exit 1)
	@echo "Lazycat packaging tools are available"

lint:
	lzc-cli project lint -f lzc-build.yml

docker-build-local: doctor
	docker buildx build --platform linux/amd64 -t $(LOCAL_IMAGE) --load .

smoke-image: docker-build-local
	@CID=$$(docker run -d -p 8080:8080 $(LOCAL_IMAGE)); \
	trap 'docker rm -f $$CID >/dev/null' EXIT INT TERM; \
	for i in $$(seq 1 60); do \
	  if curl -fsS http://127.0.0.1:8080/health >/dev/null; then \
	    echo "Image smoke test passed"; \
	    exit 0; \
	  fi; \
	  sleep 1; \
	done; \
	docker logs $$CID; \
	echo "Image smoke test failed"; \
	exit 1

build: doctor
	lzc-cli project build -f lzc-build.yml -o $(LPK_FILE)

install: build
	lzc-cli app install $(LPK_FILE) --apk n

update:
	@echo "This port embeds the Dockerfile-built runtime image via lzc-build.yml images.app-runtime."
	@echo "Run make build to rebuild the embedded image and LPK."

release-prep: lint build
	@echo "Release candidate ready: $(LPK_FILE)"

clean:
	rm -rf release-lpk .lazycat-image-ref
	rm -f *.lpk
