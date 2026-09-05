import hmac
import io
import logging
import os

import c2pa
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("c2pa-signing-service")

SHARED_SECRET = os.environ["C2PA_SERVICE_SHARED_SECRET"]
CERT_PEM = os.environ["C2PA_SIGNING_CERT_PEM"].encode("utf-8")
KEY_PEM = os.environ["C2PA_SIGNING_KEY_PEM"].encode("utf-8")
TA_URL = os.environ.get("C2PA_TIMESTAMP_URL") or None

ALLOWED_FORMATS = {"image/jpeg", "image/png", "image/webp", "image/gif"}

app = FastAPI()


def _check_auth(authorization: str | None) -> None:
    # mint-coa is the only caller. Same shared-secret-over-Bearer pattern as
    # notify-collector's own caller check, but with its own dedicated secret
    # rather than the Supabase service-role key - this service has no reason
    # to hold that key at all, and shouldn't be handed it.
    presented = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(presented, SHARED_SECRET):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _sign_callback(data: bytes) -> bytes:
    private_key = serialization.load_pem_private_key(KEY_PEM, password=None, backend=default_backend())
    return private_key.sign(data, ec.ECDSA(hashes.SHA256()))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/sign")
async def sign(
    image: UploadFile,
    format: str = Form(...),
    artist_name: str = Form(...),
    artwork_title: str = Form(...),
    mint_date: str = Form(...),
    tx_hash: str = Form(...),
    token_id: str = Form(...),
    verify_url: str = Form(...),
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)

    if format not in ALLOWED_FORMATS:
        raise HTTPException(status_code=400, detail="Unsupported format")

    # org.tracstudio.coa is a custom assertion label, not a reserved c2pa.*/
    # cawg.* namespace - this is where TRAC's own provenance fields live,
    # alongside the standard c2pa.actions assertion every C2PA manifest needs.
    manifest_definition = {
        "claim_generator_info": [{"name": "trac_c2pa_service", "version": "0.1.0"}],
        "format": format,
        "title": artwork_title,
        "ingredients": [],
        "assertions": [
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {
                            "action": "c2pa.created",
                            "digitalSourceType": "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation",
                        }
                    ]
                },
            },
            {
                "label": "org.tracstudio.coa",
                "data": {
                    "artist_name": artist_name,
                    "artwork_title": artwork_title,
                    "mint_date": mint_date,
                    "tx_hash": tx_hash,
                    "token_id": token_id,
                    "verify_url": verify_url,
                },
            },
        ],
    }

    source_stream = io.BytesIO(await image.read())
    dest_stream = io.BytesIO()

    try:
        with c2pa.Context() as context:
            with c2pa.Signer.from_callback(
                _sign_callback, c2pa.C2paSigningAlg.ES256, CERT_PEM.decode("utf-8"), TA_URL
            ) as signer:
                with c2pa.Builder(manifest_definition, context) as builder:
                    builder.sign(signer, format, source_stream, dest_stream)
    except Exception:
        logger.exception("C2PA signing failed")
        raise HTTPException(status_code=500, detail="Signing failed")

    return Response(content=dest_stream.getvalue(), media_type=format)
