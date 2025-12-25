# MiniGames auf Kubernetes (Raspberry Pi)

Dieses Repo stellt kleine statische Spiele als Kubernetes-Services bereit. Jedes Spiel bekommt seinen eigenen NodePort, damit du sie auf unterschiedlichen Ports vom Handy aus spielen kannst.

## Voraussetzungen

- Raspberry Pi mit laufendem Kubernetes (z.B. k3s)
- `kubectl` auf deinem Laptop oder direkt auf dem Pi
- Der Pi und dein Handy sind im selben Netzwerk (oder Portweiterleitung/VPN)

## Starten

Alles ausrollen:

```bash
kubectl apply -k .
```

Einzelne Spiele kannst du weiterhin über die Services ansteuern; das Deployment erfolgt am einfachsten über das Root-Kustomization.

Services prüfen:

```bash
kubectl get svc
```

Aufruf im Browser:

- Flappy Bird: `http://<raspi-ip>:30080`
- Pong: `http://<raspi-ip>:30081`

## Neues Spiel auf neuem Port

1. Neues Verzeichnis anlegen, z.B. `games/neues-spiel/index.html`.
2. `k8s/neues-spiel/` kopieren und anpassen:
   - `name` auf das neue Spiel
   - `configMapGenerator` im Root-`kustomization.yaml` auf den neuen HTML-Pfad
   - `nodePort` auf einen freien Port zwischen `30000-32767`
3. `k8s/kustomization.yaml` um den neuen Ordner erweitern.
4. `kustomization.yaml` im Root um den neuen `configMapGenerator` ergänzen.
5. Anwenden: `kubectl apply -k .`

## Hinweise

- NodePorts müssen im Bereich `30000-32767` liegen.
- Wenn du von außerhalb deines WLANs zugreifen willst, brauchst du Portweiterleitung oder einen Tunnel (z.B. Tailscale).
