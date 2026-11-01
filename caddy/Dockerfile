# Та же Caddy 2.11.4, пересобранная с исправленными Go-зависимостями.
FROM golang:1.27.1-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY main.go ./
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -ldflags="-s -w" -o /out/caddy .

FROM caddy:2.11.6-alpine@sha256:d44355d3c2149dc580ce2cac735955d1c08d3d00882c30489c241aa51a5c10d9
COPY --from=builder /out/caddy /usr/bin/caddy
LABEL org.opencontainers.image.source="https://github.com/rprokhorov/wheel-of-fortune"
