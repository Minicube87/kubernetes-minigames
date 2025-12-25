# Journey Log: Kubernetes MiniGames (Flappy + Pong)

## Goal
- Run small static games (Flappy Bird, Pong) on a Raspberry Pi Kubernetes cluster.
- Make the games reachable from a phone in the same Wi‑Fi.
- Have clean URLs and learn how Ingress, Services, and ConfigMaps work.

## What I Built
- A small repo with:
  - `games/` for static HTML/JS/CSS games.
  - `k8s/` for Kubernetes manifests (Deployments, Services, Ingress).
- Two games:
  - `games/flappy-bird/index.html`
  - `games/pong/index.html`
- Deployed both on k3s and accessed from phone.

## Steps & Learnings

### 1) Initial Structure & Kustomize
- Created two folders: `games/` for static files and `k8s/` for manifests.
- Used `kustomization.yaml` to generate ConfigMaps from `index.html` files.
- Learned: Kustomize can only reference files *inside* the current kustomization root. This caused a ConfigMap error.

### 2) Fix: Root Kustomization
- Moved the `configMapGenerator` to the repo root `kustomization.yaml`.
- Then `kubectl apply -k .` worked because it can see `games/`.
- Learned: `kubectl apply -k .` is more flexible when files are in multiple folders.

### 3) NodePort Collision
- Saw error: `nodePort is already allocated`.
- Fixed by changing NodePort to a free port.
- Learned: NodePorts must be unique in the cluster.

### 4) Accessing the Services
- NodePort format: `http://<node-ip>:<nodePort>`.
- In Minikube, `minikube service <svc> --url` creates a temporary tunnel.
- Learned: If you stop the tunnel command, the URL stops working.

### 5) Ingress Migration
- Switched Services from NodePort to ClusterIP.
- Added an Ingress for Traefik.
- Learned: Ingress needs a running Ingress Controller (Traefik in k3s).
- Also learned: Ingress host rules are required if you want pretty URLs.

### 6) Namespace Isolation
- Created a dedicated namespace `minigames`.
- Set `namespace: minigames` in root `kustomization.yaml` and added `namespace.yaml`.
- Learned: keeping game apps in their own namespace keeps things clean.

### 7) Raspberry Pi k3s Setup
- k3s failed with: `failed to find memory cgroup (v2)`.
- Fixed by adding cgroup flags to `/boot/cmdline.txt`:
  - `cgroup_enable=cpuset cgroup_enable=memory cgroup_memory=1 systemd.unified_cgroup_hierarchy=1`
- Rebooted and verified `k3s` running.
- Learned: k3s needs cgroup memory enabled on Raspberry Pi OS.

### 8) Hostname & FritzBox DNS
- FritzBox doesn’t allow arbitrary custom DNS entries by default.
- Instead used the built‑in `<device>.fritz.box` hostname.
- Updated Ingress host to `raspberrypi.fritz.box`.
- Learned: Access by IP gives 404 if Ingress expects a hostname.

### 9) Path‑based Routing
- Ingress routes:
  - `/flappy` -> flappy-bird service
  - `/pong` -> pong service
- Needed Traefik middleware to strip `/flappy` and `/pong` before nginx.
- Learned: Without strip‑prefix middleware, nginx returns 404.
- Also learned: Traefik middleware name must be referenced as `namespace-name@kubernetescrd`.

### 10) Mobile UX Fix for Pong
- Touch drag on mobile was moving the page instead of the paddle.
- Fixed with:
  - `touch-action: none;` and `overscroll-behavior: none;`
  - Pointer capture on `pointerdown`.
- Learned: For mobile canvas games, you must disable scroll/overscroll.

## Current URLs (LAN)
- `http://raspberrypi.fritz.box/flappy`
- `http://raspberrypi.fritz.box/pong`

Only accessing inside my personal WIFI Network from home. 

WIP to make them accessible for everybody.

## Issues & Fixes Summary
- **ConfigMap file outside Kustomize root** → move generator to root.
- **NodePort already used** → pick another NodePort.
- **Minikube URL not reachable after stop** → tunnel must stay running.
- **Ingress 404** → wrong host or missing strip‑prefix.
- **k3s cgroup error** → enable cgroups in cmdline and reboot.
- **Mobile touch drag issues** → disable scrolling + pointer capture.

## Things I Would Do Next
- Add a landing page that links to all games.
- Add a simple scoreboard API with persistent storage.
- Add monitoring (basic `kubectl get pods -n minigames`).
