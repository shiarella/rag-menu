# Deployment guide

## Prerequisites on the Lightsail instance

```bash
# Install Docker + Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then re-login
docker compose version          # should be ≥ 2.x
```

## One-time: upload the data files

From your local machine (run after OCR + index builds finish):

```bash
rsync -avz --progress \
  data/index.faiss \
  data/metadata_store.json \
  data/index_ocr.faiss \
  data/metadata_store_ocr.json \
  ubuntu@YOUR_LIGHTSAIL_IP:~/rag_hack/data/
```

The `MenuCardsDataset/` images are **not** needed — `USE_LOCAL_IMAGES=false` in
`docker-compose.yml` means card images are served directly from the SBB IIIF server.

## One-time: pull the Ollama model

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull llama3.2
docker compose down
```

The model weights live in the `ollama_data` Docker volume and survive restarts / rebuilds.

## First deploy

```bash
git clone https://github.com/YOUR_ORG/rag_hack.git
cd rag_hack
# (upload data files as above)
docker compose up --build -d
```

App is now live on port 80.

## Updating code (final pull before demo)

```bash
cd rag_hack
git pull
docker compose up --build -d
```

Only the `api` and `web` containers rebuild. Ollama and its model weights are untouched.

## Logs

```bash
docker compose logs -f api    # FastAPI
docker compose logs -f web    # Next.js
docker compose logs -f ollama # Ollama
```

## Lightsail firewall

Open ports **80** (HTTP) and **22** (SSH) in the Lightsail networking console.
Port 8000 (API) stays closed — the Next.js rewrite proxies it internally.

## HTTPS (optional, post-hackathon)

Add Caddy as a fourth service in `docker-compose.yml`:

```yaml
caddy:
  image: caddy:alpine
  ports: ["80:80", "443:443"]
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile
    - caddy_data:/data
```

`Caddyfile`:

```
your-domain.com {
  reverse_proxy web:3000
}
```
