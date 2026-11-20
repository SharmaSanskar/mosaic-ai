# --- build stage ---
FROM golang:1.25-alpine AS build
WORKDIR /src

# Cache deps first.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# Static binary, no CGO.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /bin/mosaic .

# --- run stage ---
FROM alpine:3.20
# TLS roots so the backend can call OpenAI/Anthropic/Google/Supabase over HTTPS.
RUN apk add --no-cache ca-certificates
COPY --from=build /bin/mosaic /bin/mosaic

ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/bin/mosaic"]
