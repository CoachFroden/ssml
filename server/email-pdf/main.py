import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote

import firebase_admin
from firebase_admin import auth
from flask import Flask, jsonify, make_response, request, send_file
from google.cloud import storage

app = Flask(__name__)

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "samnanger-skulemusikklag")
BUCKET_NAME = os.getenv("STORAGE_BUCKET", "samnanger-skulemusikklag.firebasestorage.app")
MAX_INPUT_BYTES = int(os.getenv("MAX_INPUT_BYTES", str(100 * 1024 * 1024)))
ALLOWED_ORIGINS = {
    "https://coachfroden.github.io",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5500",
    "http://localhost:5501",
}

if not firebase_admin._apps:
    firebase_admin.initialize_app()

storage_client = storage.Client(project=PROJECT_ID)
bucket = storage_client.bucket(BUCKET_NAME)


def corsify(response):
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Expose-Headers"] = "Content-Disposition, X-Original-Bytes, X-Output-Bytes, X-Compression-Ratio"
    return response


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


def validate_storage_path(value: str) -> str:
    path = str(value or "").strip().lstrip("/")
    if not path.startswith("songs/") or ".." in path or not path.lower().endswith(".pdf"):
        raise ValueError("Ugyldig PDF-sti.")
    return path


def compress_pdf(source: str, destination: str):
    command = [
        "gs",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        "-dPDFSETTINGS=/ebook",
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        "-dDetectDuplicateImages=true",
        "-dCompressFonts=true",
        f"-sOutputFile={destination}",
        source,
    ]
    subprocess.run(command, check=True, timeout=780)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "ssml-email-pdf"})


@app.route("/compress", methods=["POST", "OPTIONS"])
def compress():
    if request.method == "OPTIONS":
        return make_response("", 204)

    try:
        require_user()
        payload = request.get_json(silent=True) or {}
        storage_path = validate_storage_path(payload.get("storagePath"))
        file_name = safe_download_name(payload.get("fileName") or Path(storage_path).name)

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
                compress_pdf(source, compact)
                output_bytes = os.path.getsize(compact)
                chosen = compact if 0 < output_bytes < original_bytes else source
            except (subprocess.SubprocessError, OSError):
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
        return jsonify({"error": str(error)}), 401
    except Exception:
        app.logger.exception("PDF compression failed")
        return jsonify({"error": "Serveren klarte ikkje å klargjere PDF-fila."}), 500
