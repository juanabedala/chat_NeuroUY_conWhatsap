import os
import json
import numpy as np
import faiss
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

# Cargar .env
load_dotenv()

import google.generativeai as genai

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-004")
TOP_K_DEFAULT = int(os.getenv("TOP_K", "5"))

if not GEMINI_API_KEY:
  raise RuntimeError("Falta GEMINI_API_KEY en variables de entorno.")

genai.configure(api_key=GEMINI_API_KEY)

INDEX_FILE = os.getenv("INDEX_FILE", "vector_index.faiss")
METADATA_FILE = os.getenv("METADATA_FILE", "metadata.json")

# --------- Carga de índice y metadata ---------
def _load_index_and_metadata():
  if not os.path.exists(INDEX_FILE):
    raise FileNotFoundError(f"No existe {INDEX_FILE}")
  if not os.path.exists(METADATA_FILE):
    raise FileNotFoundError(f"No existe {METADATA_FILE}")

  index = faiss.read_index(INDEX_FILE)

  with open(METADATA_FILE, "r", encoding="utf-8") as f:
    meta_json = json.load(f)

  # Compatibilidad: tu función guardar_metadata guardaba {"metadatos": ..., "hashes": ...}
  if isinstance(meta_json, dict) and "metadatos" in meta_json:
    metadatos = meta_json["metadatos"]
  else:
    metadatos = meta_json  # fallback si es lista directa

  return index, metadatos

index, metadatos = _load_index_and_metadata()

# --------- Embeddings con Gemini ---------
def embed_text(text: str) -> np.ndarray:
  """
  Obtiene embedding con Gemini 'text-embedding-004' (dim 768) -> float32 (1,768)
  """
  # Gemini retorna un dict con "embedding": { "values": [...] }
  emb = genai.embed_content(model=EMBEDDING_MODEL, content=text)
  vec = np.array(emb["embedding"]["values"], dtype="float32")
  if vec.ndim == 1:
    vec = vec.reshape(1, -1)
  return vec

# --------- FastAPI ---------
app = FastAPI(title="FAISS Microservice", version="1.0.0")

@app.get("/health")
def health():
  return {"ok": True, "index": INDEX_FILE, "metadata_items": len(metadatos)}

@app.get("/reload")
def reload_index():
  global index, metadatos
  try:
    index, metadatos = _load_index_and_metadata()
    return {"ok": True, "metadata_items": len(metadatos)}
  except Exception as e:
    return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

@app.get("/search")
def search(
  q: str = Query(..., description="Consulta de texto"),
  k: int = Query(TOP_K_DEFAULT, ge=1, le=50, description="Cantidad de resultados")
):
  try:
    q_vec = embed_text(q)  # (1,768) float32
    D, I = index.search(q_vec, k)

    idxs = I[0].tolist()
    resultados = []
    for i in idxs:
      if 0 <= i < len(metadatos):
        resultados.append(metadatos[i])
      else:
        resultados.append(None)

    return {"ok": True, "resultados": resultados, "distancias": D[0].tolist()}
  except Exception as e:
    return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
