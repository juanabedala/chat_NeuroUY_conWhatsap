import os
import json
import numpy as np
import faiss
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

# --------- Configuración ---------
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOP_K_DEFAULT = int(os.getenv("TOP_K", "5"))
INDEX_FILE = os.getenv("INDEX_FILE", os.path.join(BASE_DIR, "vector_index.faiss"))
METADATA_FILE = os.getenv("METADATA_FILE", os.path.join(BASE_DIR, "metadata.json"))

# --------- Modelo de embeddings local ---------
print("Cargando modelo de embeddings local (all-MiniLM-L6-v2)...")
embedding_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
print("✅ Modelo de embeddings cargado")

# --------- Carga de índice y metadata ---------
def _load_index_and_metadata():
    print("DEBUG: INDEX_FILE =", INDEX_FILE)
    print("DEBUG: METADATA_FILE =", METADATA_FILE)
    print("DEBUG: Archivos existen?", os.path.exists(INDEX_FILE), os.path.exists(METADATA_FILE))

    if not os.path.exists(INDEX_FILE):
        raise FileNotFoundError(f"No existe {INDEX_FILE}")
    if not os.path.exists(METADATA_FILE):
        raise FileNotFoundError(f"No existe {METADATA_FILE}")

    index = faiss.read_index(INDEX_FILE)

    with open(METADATA_FILE, "r", encoding="utf-8") as f:
        # metadata.json ahora es una lista de objetos [{id, file, text, chunk_index}]
        metadatos = json.load(f)

    return index, metadatos

index, metadatos = _load_index_and_metadata()

# --------- Embeddings con modelo local ---------
def embed_text(text: str) -> np.ndarray:
    try:
        vec = embedding_model.encode([text], convert_to_numpy=True, normalize_embeddings=True)
        return vec.astype("float32")
    except Exception as e:
        print("ERROR embed_text:", str(e))
        raise

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
def search(q: str = Query(...), k: int = Query(TOP_K_DEFAULT, ge=1, le=50)):
    try:
        q_vec = embed_text(q)
        D, I = index.search(q_vec, k)
        idxs = I[0].tolist()
        resultados = []
        for i in idxs:
            if 0 <= i < len(metadatos):
                elem = metadatos[i]
                resultados.append({
                    "file": elem.get("file", ""),
                    "text": elem.get("text", ""),
                    "chunk_index": elem.get("chunk_index", None)
                })
            else:
                resultados.append(None)
        return {"ok": True, "resultados": resultados, "distancias": D[0].tolist()}
    except Exception as e:
        print("ERROR en /search:", str(e))
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
