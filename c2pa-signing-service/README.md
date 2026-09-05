# C2PA signing service

Small FastAPI service that embeds a signed C2PA Content Credentials manifest
into an artwork image at mint time. Exists as a separate service because
Supabase Edge Functions run in a sandboxed Deno runtime with no native
binary/FFI execution, and `c2pa-python` (the stable, documented binding) needs
one. `mint-coa` calls this over HTTPS after a successful on-chain mint, the
same non-blocking way it already calls `notify-collector` — a failure here
never fails the mint.

Not an anti-scraping tool. It doesn't stop AI training or scraping. It's a
notary stamp: artist name, mint date, and a link back to the on-chain CoA,
cryptographically signed into the file. Editing the file after signing breaks
the signature. Frame it that way in any user-facing copy — never as blocking
AI use of the image.

## Deploying to Render (staging)

1. New Web Service on Render, pointed at this repo, **root directory:
   `c2pa-signing-service`**.
2. Build command: `pip install -r requirements.txt`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Free tier is fine at TRAC's mint volume. It spins down after 15 min idle
   and takes 30-60s to wake on the next request — acceptable here because the
   caller (`mint-coa`) already treats this whole step as best-effort.
5. Set the environment variables below on the Render service.
6. Set the matching `C2PA_SIGNING_SERVICE_URL` (this service's Render URL)
   and `C2PA_SERVICE_SHARED_SECRET` (same value as below) as secrets on the
   `mint-coa` Supabase Edge Function.

## Environment variables

| Variable | Purpose |
|---|---|
| `C2PA_SERVICE_SHARED_SECRET` | Bearer token `mint-coa` must present. Generate a fresh random value (e.g. `openssl rand -hex 32`) — don't reuse any existing project secret. This service has no reason to hold the Supabase service-role key, so it never gets it. |
| `C2PA_SIGNING_CERT_PEM` | Full PEM-encoded cert chain (leaf cert first, then issuer), as one multi-line env var value. Same pattern as `PLATFORM_WALLET_PRIVATE_KEY` elsewhere in this project — swapping in a real certificate later is just a config change. |
| `C2PA_SIGNING_KEY_PEM` | The leaf certificate's private key, PEM-encoded. |
| `C2PA_TIMESTAMP_URL` | Optional. RFC 3161 timestamp authority URL. Omit for now. |

**Never commit `C2PA_SIGNING_CERT_PEM` / `C2PA_SIGNING_KEY_PEM` values to
git**, even the test ones — they're env vars on Render only.

## The test certificate

Built locally as a self-signed ES256 (EC P-256) chain matching the exact
structure the C2PA spec requires — verified against the real cert/key pair
`c2pa-python`'s own test suite ships (`tests/fixtures/es256_certs.pem`) rather
than guessed: leaf cert with `CA:FALSE`, critical `keyUsage` =
`digitalSignature, nonRepudiation`, critical `extendedKeyUsage` =
`emailProtection`; issuer with `CA:TRUE`, `keyUsage` =
`digitalSignature, keyCertSign, cRLSign`. Sent to you directly (not committed,
not pasted in chat) — set as the two env vars above on Render.

Signing with it produces a fully valid manifest — every assertion hash and
claim signature checks out — with exactly one expected finding:
`signingCredential.untrusted`, because no one has loaded this test root CA
into a trust list. That resolves itself the moment the real SSL.com
Assurance Level 1 C2PA certificate is swapped in (same two env vars, no code
change).

## Manifest contents

Custom assertion labeled `org.tracstudio.coa` (not a reserved `c2pa.*`/
`cawg.*` namespace), alongside the standard `c2pa.actions` assertion every
manifest needs:

```json
{
  "artist_name": "...",
  "artwork_title": "...",
  "mint_date": "2026-09-05T00:00:00Z",
  "tx_hash": "0x...",
  "token_id": "10",
  "verify_url": "https://amoy.polygonscan.com/tx/0x..."
}
```

`verify_url` reuses the exact PolygonScan link pattern `collector.html`
already shows collectors ("View on PolygonScan") — no new verification page
was invented.

## API

`POST /sign` — multipart form: `image` (file), `format` (one of
`image/jpeg`, `image/png`, `image/webp`, `image/gif` — matches the
`artwork-images` bucket's own allowed MIME types), `artist_name`,
`artwork_title`, `mint_date`, `tx_hash`, `token_id`, `verify_url`. Requires
`Authorization: Bearer <C2PA_SERVICE_SHARED_SECRET>`. Returns the signed
image bytes.

`GET /health` — for Render's health checks.
