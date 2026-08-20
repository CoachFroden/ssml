import hashlib
import os
import re
import secrets
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

import firebase_admin
from firebase_admin import auth, firestore
from flask import Flask, jsonify, make_response, request, send_file
from google.cloud import storage

app = Flask(__name__)

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "samnanger-skulemusikklag")
BUCKET_NAME = os.getenv("STORAGE_BUCKET", "samnanger-skulemusikklag.firebasestorage.app")
MAX_INPUT_BYTES = int(os.getenv("MAX_INPUT_BYTES", str(100 * 1024 * 1024)))
MAX_REQUESTED_PAGES = int(os.getenv("MAX_REQUESTED_PAGES", "300"))
MAX_SHARE_ITEMS = int(os.getenv("MAX_SHARE_ITEMS", "60"))
DEFAULT_SHARE_DAYS = int(os.getenv("DEFAULT_SHARE_DAYS", "30"))
MAX_SHARE_DAYS = int(os.getenv("MAX_SHARE_DAYS", "90"))
PRODUCTION_ORIGIN = "https://coachfroden.github.io"
ALLOWED_ORIGINS = {
    PRODUCTION_ORIGIN,
    "http://127.0.0.1:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5500",
    "http://localhost:5501",
}

if not firebase_admin._apps:
    firebase_admin.initialize_app()

storage_client = storage.Client(project=PROJECT_ID)
bucket = storage_client.bucket(BUCKET_NAME)
db = firestore.client()


def allowed_origin():
    origin = (request.headers.get("Origin") or "").rstrip("/")
    if origin in ALLOWED_ORIGINS:
        return origin
    return PRODUCTION_ORIGIN


def corsify(response):
    response.headers["Access-Control-Allow-Origin"] = allowed_origin()
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, HEAD, POST, OPTIONS"
    response.headers["Access-Control-Max-Age"] = "3600"
    response.headers["Access-Control-Expose-Headers"] = "Content-Disposition, X-Original-Bytes, X-Output-Bytes, X-Compression-Ratio"
    return response


@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        return corsify(make_response("", 204))
    return None


@app.after_request
def add_cors_headers(response):
    return corsify(response)


def require_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise ValueError("Mangler innlogging.")
    token = header[7:].strip()
    if not token:
        raise ValueError("Mangler innlogging.")
    return auth.verify_id_token(token)


def safe_download_name(value: str) -> str:
    name = Path(value or "Notar.pdf").name
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    name = re.sub(r'[\\/:*?"<>|]+', "-", name)
    return re.sub(r"\s+", " ", name).strip() or "Notar.pdf"


def clean_text(value, fallback=""):
    return re.sub(r"\s+", " ", str(value or fallback)).strip()[:250]


def normalize_storage_path(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("Ugyldig PDF-sti.")

    path = raw
    if raw.startswith("gs://"):
        parsed = urlparse(raw)
        if parsed.netloc and parsed.netloc != BUCKET_NAME:
            raise ValueError("Ugyldig PDF-sti.")
        path = parsed.path.lstrip("/")
    elif raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        host = parsed.netloc.lower()
        if host == "firebasestorage.googleapis.com":
            marker = "/o/"
            if marker not in parsed.path:
                raise ValueError("Ugyldig PDF-sti.")
            prefix, encoded_path = parsed.path.split(marker, 1)
            bucket_match = re.search(r"/b/([^/]+)$", prefix)
            if bucket_match and bucket_match.group(1) != BUCKET_NAME:
                raise ValueError("Ugyldig PDF-sti.")
            path = unquote(encoded_path)
        elif host == "storage.googleapis.com":
            pieces = parsed.path.lstrip("/").split("/", 1)
            if len(pieces) != 2 or pieces[0] != BUCKET_NAME:
                raise ValueError("Ugyldig PDF-sti.")
            path = unquote(pieces[1])
        else:
            raise ValueError("Ugyldig PDF-sti.")

    path = unquote(path).strip().lstrip("/")
    segments = [segment for segment in path.split("/") if segment]
    if (
        not path
        or len(path) > 1024
        or "\x00" in path
        or any(segment in {".", ".."} for segment in segments)
        or not path.lower().endswith(".pdf")
    ):
        raise ValueError("Ugyldig PDF-sti.")
    return path


def validate_storage_path(value: str) -> str:
    return normalize_storage_path(value)


def validate_pages(value):
    if value in (None, [], ""):
        return None
    if not isinstance(value, list):
        raise ValueError("Ugyldig sideliste.")
    pages = []
    seen = set()
    for raw in value:
        if isinstance(raw, bool):
            raise ValueError("Ugyldig sideliste.")
        try:
            page = int(raw)
        except (TypeError, ValueError):
            raise ValueError("Ugyldig sideliste.") from None
        if page < 1:
            raise ValueError("Ugyldig sideliste.")
        if page not in seen:
            pages.append(page)
            seen.add(page)
    if not pages or len(pages) > MAX_REQUESTED_PAGES:
        raise ValueError("For mange eller ingen PDF-sider er valde.")
    return pages


def validate_share_items(value):
    if not isinstance(value, list) or not value:
        raise ValueError("Vel minst éi stemme som skal delast.")
    if len(value) > MAX_SHARE_ITEMS:
        raise ValueError("For mange stemmer i éi deling.")
    items = []
    for raw in value:
        if not isinstance(raw, dict):
            raise ValueError("Ugyldig stemme i delinga.")
        storage_path = validate_storage_path(raw.get("storagePath"))
        name = clean_text(raw.get("name"), "Stemme")
        file_name = safe_download_name(raw.get("fileName") or f"{name}.pdf")
        pages = validate_pages(raw.get("pages"))
        items.append({
            "name": name,
            "fileName": file_name,
            "storagePath": storage_path,
            "pages": pages,
        })
    return items


def token_doc(token: str):
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return db.collection("noteShares").document(token_hash)


def load_share(token: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,120}", token or ""):
        return None, "invalid"
    snapshot = token_doc(token).get()
    if not snapshot.exists:
        return None, "missing"
    data = snapshot.to_dict() or {}
    expires_at = data.get("expiresAt")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            return data, "expired"
    return data, None


def run_pdfwrite(source: str, destination: str, pages=None, settings="/ebook"):
    command = [
        "gs",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        f"-dPDFSETTINGS={settings}",
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        "-dSAFER",
        "-dDetectDuplicateImages=true",
        "-dCompressFonts=true",
    ]
    if pages:
        command.append(f"-sPageList={','.join(str(page) for page in pages)}")
    command.extend([f"-sOutputFile={destination}", source])
    subprocess.run(command, check=True, timeout=780)


def compress_pdf(source: str, destination: str, pages=None):
    run_pdfwrite(source, destination, pages, settings="/ebook")


def extract_pdf_pages(source: str, destination: str, pages):
    run_pdfwrite(source, destination, pages, settings="/printer")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "service": "ssml-email-pdf",
        "pageSelection": True,
        "cors": True,
        "shareLinks": True,
        "legacyStoragePaths": True,
    })


@app.route("/shares", methods=["POST", "OPTIONS"])
def create_share():
    try:
        user = require_user()
        payload = request.get_json(silent=True) or {}
        items = validate_share_items(payload.get("items"))
        try:
            days = int(payload.get("expiresDays") or DEFAULT_SHARE_DAYS)
        except (TypeError, ValueError):
            days = DEFAULT_SHARE_DAYS
        days = max(1, min(MAX_SHARE_DAYS, days))

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=days)
        token = secrets.token_urlsafe(32)
        token_doc(token).set({
            "title": clean_text(payload.get("title"), "Delte notar"),
            "composer": clean_text(payload.get("composer")),
            "arranger": clean_text(payload.get("arranger")),
            "items": items,
            "createdAt": now,
            "expiresAt": expires_at,
            "requestedBy": user.get("uid"),
        })
        return jsonify({
            "token": token,
            "count": len(items),
            "expiresAt": expires_at.isoformat(),
        })
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        app.logger.exception("Share creation failed")
        return jsonify({"error": "Serveren klarte ikkje å opprette delingslenka."}), 500


@app.route("/share/<token>", methods=["GET"])
def get_share(token):
    share, error = load_share(token)
    if error == "expired":
        return jsonify({"error": "Denne delingslenka har gått ut."}), 410
    if error:
        return jsonify({"error": "Delingslenka finst ikkje."}), 404

    base = request.host_url.rstrip("/")
    encoded_token = quote(token, safe="")
    files = []
    for index, item in enumerate(share.get("items") or []):
        file_url = f"{base}/share/{encoded_token}/file/{index}"
        files.append({
            "name": item.get("name") or "Stemme",
            "fileName": item.get("fileName") or "Notar.pdf",
            "openUrl": file_url,
            "downloadUrl": f"{file_url}?download=1",
        })

    expires_at = share.get("expiresAt")
    return jsonify({
        "title": share.get("title") or "Delte notar",
        "composer": share.get("composer") or "",
        "arranger": share.get("arranger") or "",
        "expiresAt": expires_at.isoformat() if isinstance(expires_at, datetime) else None,
        "files": files,
    })


@app.route("/share/<token>/file/<int:index>", methods=["GET"])
def shared_file(token, index):
    share, error = load_share(token)
    if error == "expired":
        return jsonify({"error": "Denne delingslenka har gått ut."}), 410
    if error:
        return jsonify({"error": "Delingslenka finst ikkje."}), 404

    items = share.get("items") or []
    if index < 0 or index >= len(items):
        return jsonify({"error": "Denne stemma finst ikkje i delinga."}), 404

    item = items[index]
    try:
        storage_path = validate_storage_path(item.get("storagePath"))
        pages = validate_pages(item.get("pages"))
        file_name = safe_download_name(item.get("fileName") or item.get("name") or "Notar.pdf")
        blob = bucket.blob(storage_path)
        blob.reload()
        if not blob.exists():
            return jsonify({"error": "PDF-fila finst ikkje lenger."}), 404
        if blob.size and blob.size > MAX_INPUT_BYTES:
            return jsonify({"error": "PDF-fila er for stor til å opnast via delingslenka."}), 413

        with tempfile.TemporaryDirectory(prefix="ssml-share-") as workdir:
            source = os.path.join(workdir, "source.pdf")
            output = os.path.join(workdir, "selected.pdf")
            blob.download_to_filename(source)
            chosen = source
            if pages:
                extract_pdf_pages(source, output, pages)
                chosen = output

            download = request.args.get("download") == "1"
            response = send_file(
                chosen,
                mimetype="application/pdf",
                as_attachment=download,
                download_name=file_name,
                max_age=0,
                conditional=True,
            )
            response.headers["Cache-Control"] = "private, no-store"
            return response
    except (ValueError, subprocess.SubprocessError, OSError) as error:
        app.logger.exception("Shared PDF failed")
        return jsonify({"error": str(error) or "PDF-fila kunne ikkje opnast."}), 500


@app.route("/compress", methods=["POST", "OPTIONS"])
def compress():
    try:
        require_user()
        payload = request.get_json(silent=True) or {}
        storage_path = validate_storage_path(payload.get("storagePath"))
        file_name = safe_download_name(payload.get("fileName") or Path(storage_path).name)
        pages = validate_pages(payload.get("pages"))

        blob = bucket.blob(storage_path)
        blob.reload()
        if not blob.exists():
            return jsonify({"error": "PDF-fila finst ikkje."}), 404
        if blob.size and blob.size > MAX_INPUT_BYTES:
            return jsonify({"error": "PDF-fila er for stor for e-postkomprimering."}), 413

        with tempfile.TemporaryDirectory(prefix="ssml-email-") as workdir:
            source = os.path.join(workdir, "source.pdf")
            compact = os.path.join(workdir, "compact.pdf")
            blob.download_to_filename(source)
            original_bytes = os.path.getsize(source)

            try:
                compress_pdf(source, compact, pages)
                output_bytes = os.path.getsize(compact)
                chosen = compact if pages or (0 < output_bytes < original_bytes) else source
            except (subprocess.SubprocessError, OSError):
                if pages:
                    raise
                chosen = source

            final_bytes = os.path.getsize(chosen)
            ratio = (final_bytes / original_bytes) if original_bytes else 1
            response = send_file(
                chosen,
                mimetype="application/pdf",
                as_attachment=True,
                download_name=file_name,
                max_age=0,
            )
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Original-Bytes"] = str(original_bytes)
            response.headers["X-Output-Bytes"] = str(final_bytes)
            response.headers["X-Compression-Ratio"] = f"{ratio:.4f}"
            response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(file_name)}"
            return response
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        app.logger.exception("PDF compression failed")
        return jsonify({"error": "Serveren klarte ikkje å klargjere PDF-fila."}), 500
