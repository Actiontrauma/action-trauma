"""Sauvegarde hebdomadaire Action Trauma : copie toutes les données de Supabase
dans le dossier OneDrive « Backup plateforme ». Aucune donnée n'est affichée dans
le journal (le dépôt est public) : seulement des compteurs."""
import json, os, sys, urllib.request, urllib.parse, datetime

SB_URL = "https://juhnkuxxzomaramxmuik.supabase.co"
DRIVE_ID = os.environ["ONEDRIVE_DRIVE_ID"]
FOLDER_ID = os.environ["ONEDRIVE_FOLDER_ID"]

def req(url, data=None, headers=None, method=None):
    r = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        body = e.read()[:300].decode("utf-8", "replace")
        sys.exit(f"Erreur HTTP {e.code} sur {url.split('?')[0]} : {body}")

def secret(name):
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"Secret GitHub manquant : {name}")
    return v

key = secret("SUPABASE_SECRET_KEY")
h = {"apikey": key, "Accept": "application/json"}
if key.startswith("eyJ"):  # ancienne clé service_role (JWT)
    h["Authorization"] = "Bearer " + key

rows, start = [], 0
while True:
    q = urllib.parse.urlencode({"select": "path,col,data", "col": "in.(docs,orgs,config)", "order": "path"})
    _, b = req(f"{SB_URL}/rest/v1/at_docs?{q}", headers={**h, "Range": f"{start}-{start + 999}"})
    page = json.loads(b)
    rows += page
    if len(page) < 1000:
        break
    start += 1000

docs = {r["path"]: r["data"] for r in rows}
n = {c: sum(1 for r in rows if r["col"] == c) for c in ("docs", "orgs", "config")}
print(f"Lu dans Supabase : {n['docs']} documents, {n['orgs']} clients, {n['config']} paramètres")
if not n["docs"] or not n["config"]:
    sys.exit("Sauvegarde annulée : aucune donnée lue (droits manquants?)")

now = datetime.datetime.now(datetime.timezone.utc)
payload = json.dumps({"app": "facturation-action-trauma", "version": 1, "exporte": now.isoformat(), "docs": docs},
                     ensure_ascii=False).encode("utf-8")

tenant, cid, csec = secret("MS_TENANT_ID"), secret("MS_CLIENT_ID"), secret("MS_CLIENT_SECRET")
_, b = req(f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
           data=urllib.parse.urlencode({"client_id": cid, "client_secret": csec, "grant_type": "client_credentials",
                                        "scope": "https://graph.microsoft.com/.default"}).encode(),
           headers={"Content-Type": "application/x-www-form-urlencoded"})
token = json.loads(b)["access_token"]

local = (now - datetime.timedelta(hours=5)).strftime("%Y-%m-%d")
name = urllib.parse.quote(f"Sauvegarde Action Trauma {local}.json")
status, _ = req(f"https://graph.microsoft.com/v1.0/drives/{DRIVE_ID}/items/{FOLDER_ID}:/{name}:/content",
                data=payload, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="PUT")
print(f"Fichier envoyé dans OneDrive ({len(payload)} octets, code {status})")
