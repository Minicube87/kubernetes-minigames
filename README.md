# MiniGames on Kubernetes (Raspberry Pi)

This repo serves small static games (Flappy Bird + Pong) via Kubernetes. It uses Ingress so you can open clean URLs from your phone in the same Wi‑Fi.

## Prerequisites

- Raspberry Pi running Kubernetes (k3s)
- `kubectl` on your laptop or directly on the Pi
- Phone and Pi are in the same network (or you use a tunnel)

## Deploy (k3s + Traefik Ingress)

Apply everything:

```bash
kubectl apply -k .
```

Check pods/services:

```bash
kubectl get pods -n minigames
kubectl get svc -n minigames
```

Check ingress:

```bash
kubectl get ingress -n minigames
kubectl describe ingress -n minigames minigames
```

Ingress test without DNS (Host header):

```bash
curl -H "Host: raspberrypi.fritz.box" http://<raspi-ip>/flappy
curl -H "Host: raspberrypi.fritz.box" http://<raspi-ip>/pong
```

## FritzBox Hostname (No Custom DNS)

FritzBox does not let you define arbitrary local DNS records by default. Use the device hostname instead.

1) Set the Raspberry Pi name in the FritzBox UI:
   - Heimnetz -> Netzwerk -> Raspberry Pi -> Edit -> Name (e.g. `raspberrypi`)
2) The device is then reachable at `raspberrypi.fritz.box`.
3) Open on your phone:
   - `http://raspberrypi.fritz.box/flappy`
   - `http://raspberrypi.fritz.box/memory`
   - `http://raspberrypi.fritz.box/pong`
   - `http://raspberrypi.fritz.box/snake`

Optional DNS check:

```bash
nslookup raspberrypi.fritz.box
```

## Add a New Game

1) Create a new game folder, e.g. `games/new-game/index.html`.
2) Copy `k8s/flappy-bird/` to `k8s/new-game/` and update:
   - `name` to the new game name
   - add a new entry in the root `kustomization.yaml` `configMapGenerator`
3) Add the new folder to `k8s/kustomization.yaml`.
4) Optionally extend `k8s/ingress/ingress.yaml` with a new path.
5) Apply:

```bash
kubectl apply -k .
```
