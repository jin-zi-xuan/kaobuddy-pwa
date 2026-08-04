FROM rust:1.96-bookworm AS builder

WORKDIR /app
RUN rustup target add wasm32-unknown-unknown \
    && cargo install dioxus-cli --version 0.7.10 --locked

COPY Cargo.toml Cargo.lock ./
COPY rust-app ./rust-app
RUN cd rust-app && dx build --web --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/dx/kaobuddy/release/web ./app

ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["sh", "-c", "wget -qO- http://127.0.0.1:${PORT}/health >/dev/null || exit 1"]

CMD ["./app/server"]
