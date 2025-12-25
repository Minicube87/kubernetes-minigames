# MiniGames auf Kubernetes (Raspberry Pi)

Dieses Repo stellt kleine statische Spiele als Kubernetes-Services bereit. Mit Ingress kannst du sie über feste URLs wie `flappy.lan` und `pong.lan` erreichen.

## Voraussetzungen

- Raspberry Pi mit laufendem Kubernetes (k3s)
- `kubectl` auf deinem Laptop oder direkt auf dem Pi
- Der Pi und dein Handy sind im selben Netzwerk (oder Portweiterleitung/VPN)

## Starten (Ingress mit k3s / Traefik)

Alles ausrollen:

```bash
kubectl apply -k .
```

DNS in der FritzBox setzen:

- `flappy.lan` → IP deines Raspberry Pi
- `pong.lan` → IP deines Raspberry Pi

Dann im Handy-Browser:

- `http://flappy.lan`
- `http://pong.lan`

## Neues Spiel hinzufügen

1. Neues Verzeichnis anlegen, z.B. `games/neues-spiel/index.html`.
2. `k8s/neues-spiel/` kopieren und anpassen:
   - `name` auf das neue Spiel
   - `configMapGenerator` im Root-`kustomization.yaml` auf den neuen HTML-Pfad
3. `k8s/kustomization.yaml` um den neuen Ordner erweitern.
4. `kustomization.yaml` im Root um den neuen `configMapGenerator` ergänzen.
5. Optional: `k8s/ingress/ingress.yaml` um einen neuen Host erweitern.
6. Anwenden: `kubectl apply -k .`
