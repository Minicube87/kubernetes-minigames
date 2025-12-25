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

Pods/Services prüfen:

```bash
kubectl get pods -n minigames
kubectl get svc -n minigames
```

Ingress prüfen:

```bash
kubectl get ingress -n minigames
kubectl describe ingress -n minigames minigames
```

Ingress lokal testen (ohne DNS):

```bash
curl -H "Host: flappy.lan" http://<raspi-ip>
curl -H "Host: pong.lan" http://<raspi-ip>
```

DNS in der FritzBox setzen:

- `flappy.lan` → IP deines Raspberry Pi
- `pong.lan` → IP deines Raspberry Pi

Dann im Handy-Browser:

- `http://flappy.lan`
- `http://pong.lan`

DNS testen vom Laptop (optional):

```bash
nslookup flappy.lan
nslookup pong.lan
```

## Neues Spiel hinzufügen

1. Neues Verzeichnis anlegen, z.B. `games/neues-spiel/index.html`.
2. `k8s/neues-spiel/` kopieren und anpassen:
   - `name` auf das neue Spiel
   - `configMapGenerator` im Root-`kustomization.yaml` auf den neuen HTML-Pfad
3. `k8s/kustomization.yaml` um den neuen Ordner erweitern.
4. `kustomization.yaml` im Root um den neuen `configMapGenerator` ergänzen.
5. Optional: `k8s/ingress/ingress.yaml` um einen neuen Host erweitern.
6. Anwenden: `kubectl apply -k .`

## Hinweise

- Wenn du von außerhalb deines WLANs zugreifen willst, brauchst du Portweiterleitung oder einen Tunnel (z.B. Tailscale).
