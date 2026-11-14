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

### 11) Post-Mortem: Cluster Dead for 7 Months (Nov 2026)

After almost a year of not logging in, the Pi turned out to be completely broken.

**Symptoms**
- Root disk (`/dev/sda2`, 28 GB) was **100% full**.
- `k3s` stuck in `activating`, **691 restarts**, `k3s-server` at 100% CPU, Pi at 65 °C while idle.
- In the namespace `minigames`: **31× `ContainerStatusUnknown`**, 3× `Error`, and one `Pending` pod per game. No game reachable.

**Root cause chain**
1. `k3s` kept crashing with `fatal error: invalid runtime symbol table` (a Go runtime crash).
2. The systemd unit has `LimitCORE=infinity` and the kernel `core_pattern` is plain `core`, so **every crash wrote a core dump** into k3s' working directory `/var/lib/rancher/k3s/server/`.
3. 76 dumps, up to **~500 MB each** (April 22/23, 2026), filled **~24 GB** of the disk.
4. The kubelet set the node condition **`DiskPressure`** → pods were evicted.
5. The Deployments immediately created replacement pods, which were **rejected** because the node still had DiskPressure. That's why every game had 5–6 dead copies:
   ```bash
   kubectl get pod -n minigames <pod> -o jsonpath='{.status.reason}{"\n"}{.status.message}{"\n"}'
   # Evicted
   # Pod was rejected: The node had condition: [DiskPressure].
   ```

**Diagnosis tools that helped**
- `du -xh / --max-depth=3 | sort -rh | head` → found `/var/lib/rancher` = 25 GB.
- `systemctl show k3s -p NRestarts` → number of restarts.
- `journalctl -u k3s | grep -i "fatal\|panic"` → the actual crash message.
- `sha256sum /usr/local/bin/k3s` compared with the official release checksum → **binary was fine** (first guess "corrupted binary" was wrong).
- `vcgencmd get_throttled` → `0x0`, so no undervoltage/overheating; `dmesg` → no OOM kills.
- The root cause of the original crash can't be proven anymore: the journal only went back to the day of the fix (disk full = no old logs). Memory pressure on 1 GB RAM is the most likely trigger.

**Fix 1: Disk**
- Stopped k3s, kept the 2 newest dumps in `/var/lib/rancher/k3s-crash-evidence/`, deleted the other 74 → disk from 100% to **16%**.
- Prevented it from happening again with a systemd drop-in:
  ```ini
  # /etc/systemd/system/k3s.service.d/no-coredumps.conf
  [Service]
  LimitCORE=0
  ```
- Then `apt full-upgrade` (new kernel 6.18) + reboot. When asked about `/etc/ssh/sshd_config`, kept the **local** version (it has `PermitRootLogin no`, `PasswordAuthentication no`).
- After reboot: k3s `active`, **0 crashes**.

**Problem 2: Thrashing (1 GB RAM is not enough)**
- After the reboot, load average was **15–19** on 4 cores, SSH and `kubectl` timed out, API server returned `ServiceUnavailable`.
- Harmless side effect in the logs: `watch ended with error ... http2: client connection lost` — the API server was too overloaded to answer its own watchers (80 warnings in one minute, then gone).
- `vmstat 3 5` showed the real cause (ignore the first line, it's the average since boot):

  | column | value | meaning |
  |---|---|---|
  | `swpd` | ~490 MB | half the system swapped out (zram) |
  | `si` / `so` | 3,000–14,000 KB/s | constant swapping = **thrashing** |
  | `b` | 4–13 | processes blocked waiting for I/O |
  | `wa` | 22–54 % | CPU idle waiting for disk |

- Swap is only a problem when `si`/`so` are constantly high, not when something just sits in swap.
- zram = compressed swap inside RAM: faster than disk, but compressing costs CPU.

**Fix 2: Freeing RAM**
- Scaled all games to 0 → load dropped, `b` = 0, CPU idle 73–91 %.
- Deleted all dead pods:
  ```bash
  kubectl delete pods -n minigames --field-selector=status.phase=Failed
  kubectl delete pods -n minigames --field-selector=status.phase=Succeeded
  ```
- Baseline without any game: ~385 MB available. **k3s + containerd alone need ~450–500 MB.**
- Scaled games back up one by one and measured with `free -h` + `vmstat`:
  - one static nginx game costs only ~15 MB (mostly per-pod overhead)
  - 5 static games → `so` started rising again
- Disabled the metrics-server permanently (only needed for `kubectl top`):
  ```yaml
  # /etc/rancher/k3s/config.yaml
  disable:
    - metrics-server
  ```
- Found a leftover from another project: `pm2-root.service` was running `Sleep-Tracker-GUI/api/server.js` **as root** since every boot. Disabled with `sudo systemctl disable --now pm2-root` (running a web backend as root is a security risk).
- Final state: k3s + 4 static games, RAM + swap ~790 MB, CPU idle ~90 %, only occasional small swap-outs.

**Fix 3: Repo matches reality**
- Added `resources.requests` / `resources.limits` to **every** Deployment:
  - static games (nginx): `16Mi`/`10m` requested, `32Mi`/`100m` limit
  - Node backends: `48Mi`/`50m` requested, `96Mi`/`250m` limit
  - redis: `16Mi`/`10m` requested, `64Mi`/`100m` limit
- Set `replicas: 0` for `flappy-score-api`, `soccer-rt`, `redis` and `soccer` (soccer is useless without `soccer-rt`). Without the score API, Flappy Bird highscores return 503.
- Typo lesson: I wrote `request:` instead of `requests:`. `kubectl kustomize` said OK, because it only checks YAML syntax, not the Kubernetes schema. Use `kubectl apply -k . --dry-run=server` to let the API server validate.

**Learned**
- A full disk can kill a whole cluster: DiskPressure → evictions → rejected pods → nothing runs.
- Crashing services + unlimited core dumps = disk bomb. Always cap `LimitCORE`.
- `vmstat` tells you *why* a machine is slow (CPU vs. RAM vs. disk); load average alone doesn't.
- Without resource limits, pods compete for RAM until the whole node thrashes. With limits, only the offending pod gets `OOMKilled`.
- `requests` = what the scheduler reserves, `limits` = hard ceiling (memory → kill, CPU → throttle).
- A Pi 3 with 1 GB RAM is the absolute minimum for k3s; k3s recommends 2 GB+ for a server node.
- Check what else runs on a box (`ps aux`, `systemctl list-units`) — old experiments keep eating resources.

## Current URLs (LAN)
- `http://raspberrypi.fritz.box/flappy` (without highscores, score API is scaled to 0)
- `http://raspberrypi.fritz.box/pong`
- `http://raspberrypi.fritz.box/memory`
- `http://raspberrypi.fritz.box/snake`
- `/soccer` is disabled (`replicas: 0`) on the Pi 3.

Only accessing inside my personal WIFI Network from home. 

WIP to make them accessible for everybody.

## Issues & Fixes Summary
- **ConfigMap file outside Kustomize root** → move generator to root.
- **NodePort already used** → pick another NodePort.
- **Minikube URL not reachable after stop** → tunnel must stay running.
- **Ingress 404** → wrong host or missing strip‑prefix.
- **k3s cgroup error** → enable cgroups in cmdline and reboot.
- **Mobile touch drag issues** → disable scrolling + pointer capture.
- **Disk 100% full from k3s core dumps** → delete dumps, `LimitCORE=0` drop-in.
- **Pods `Evicted` / rejected with `DiskPressure`** → free disk, delete failed pods via `--field-selector`.
- **Node thrashing (load 15+, API timeouts)** → scale down, disable metrics-server, add resource limits.
- **Forgotten pm2 app running as root** → `systemctl disable --now pm2-root`.

## Things I Would Do Next
- Add a landing page that links to all games.
- ~~Add a simple scoreboard API with persistent storage.~~ Done (score API + redis), but scaled to 0 on the Pi 3.
- Add monitoring (basic `kubectl get pods -n minigames`).
- Add `readinessProbe` / `livenessProbe` to all Deployments.
- Pin image versions (`nginx:alpine` → fixed tag) and upgrade `node:18-alpine` (EOL) to `node:22-alpine`.
- Build real images with Dockerfiles + GitHub Actions (multi-arch) instead of mounting code via ConfigMaps.
- Move to stronger hardware (Pi 4/5 with 4–8 GB or a small cloud VM) to run the backends again.
- Make the games reachable from outside the LAN without opening router ports (Tailscale or Cloudflare Tunnel).
