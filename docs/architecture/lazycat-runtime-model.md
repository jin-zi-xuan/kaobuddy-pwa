# Lazycat Runtime Model

## Runtime Model

- Delivery: existing Dockerfile, embedded into the LPK via `lzc-build.yml` `images.app-runtime`.
- Entry: HTTP route `/=http://kaobuddy:8080`.
- Persistence: `/lzcapp/var/work` bound to `/app/work` for invite usage state.
- Dependencies: single business service; no database, Redis, object storage, or queue.
- Init: no setup script required. The Dockerfile builds the React app and runs `uvicorn backend.app.main:app`.
- Login: no in-app account. Lazycat platform access protects the app; KaoBuddy itself uses BYOK or optional invite codes.
- File selection: `application.injects` adds Lazycat file chooser support for upload/save flows.

## Runability Gate

- Image/Arch: Dockerfile is multi-stage Node 22 + Python 3.11 and can be built for `linux/amd64` by `lzc-cli` during LPK build.
- Process: long-running foreground `uvicorn` process.
- Network: app listens on `0.0.0.0:${PORT:-8080}` and exposes `/health`.
- Storage: server write path is redirected to `/app/work`, backed by `/lzcapp/var/work`.
- Dependencies: no local infrastructure dependencies.
- External requirements: AI calls require user-provided OpenAI-compatible API credentials unless the administrator configures invite-mode server credentials.

Conclusion: `Can Run`. `make build` produced an LPK with the embedded runtime image, the package was installed on the default Lazycat MicroServer, and the `kaobuddy` service reported healthy with `/health` returning `{"ok": true}`.

## Service Layers

```text
business: kaobuddy FastAPI + static PWA
```

No infra or seed layer is required, so `depends_on` is intentionally absent.
