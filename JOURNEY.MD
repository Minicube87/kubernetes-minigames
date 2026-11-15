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
- At this point the root cause of the crash was still unclear (the journal only went back to the day of the fix, disk full = no old logs). It was found later the same day, see **Fix 4 / Real root cause** below.

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

**Fix 4 / Real root cause: the USB stick is dying**

While applying the new manifests, things kept crashing:
1. `kubectl apply -k .` itself crashed with `SIGSEGV: segmentation violation` deep inside the Go runtime (stack unwinder / garbage collector). The trace contained impossible values (e.g. a frame pointer `fp=0x...270f`, which can't be odd on arm64) → data in memory was corrupted. Nothing was applied (Pong still had `resources: {}`).
2. Second try: 5 Deployments were configured, then `unexpected EOF` on `snake` and `connection refused` for everything after → **k3s died mid-request**.

Ruled out step by step:
- **Overclocking:** `config.txt` is stock, `vcgencmd measure_clock arm` = 1200 MHz (Pi 3B default). `arm_boost=1` only affects the Pi 4.
- **Out of memory:** `sudo dmesg | grep -i oom` → no OOM kills.

The decisive hints:
```bash
sudo journalctl -u k3s -b | grep -E "Main process exited"
# k3s.service: Main process exited, code=killed, status=7/BUS   (16:36:49 and 17:59:34)

lsblk -o NAME,SIZE,MODEL,TRAN
# sda  28.7G SanDisk 3.2Gen1 usb      ← the whole OS runs from a USB stick

sudo dmesg | grep -i "medium error"
# sd 0:0:0:0: [sda] Sense Key : 0x3 [current]   ASC=0x11 ASCQ=0x0
# critical medium error, dev sda, sector 35812896 op 0x0:(READ)
```
- Tip: `journalctl` without `sudo` showed nothing — my user can't read the system journal.
- `Sense Key 0x3` + `ASC 0x11` = **Medium Error – Unrecovered Read Error**, reported by the stick itself. Some flash cells are dead.
- `SIGBUS` (not `SIGSEGV`) = the kernel couldn't deliver data that should exist. Linux loads programs page by page from disk and drops those pages again when RAM is tight. When a page has to be re-read from a broken sector, the process gets `SIGBUS`.

**The full chain (final version):**
1. The OS + k3s run from a cheap USB stick. k3s writes small changes to its database all the time; 24 GB of core dumps came on top → the flash **wore out**.
2. Broken sectors → reading program code fails (`SIGBUS`) or returns garbage (`invalid runtime symbol table`, corrupted `kubectl` trace) → k3s crashes.
3. Every crash wrote a core dump → disk full → `DiskPressure` → all pods evicted/rejected.
4. 1 GB RAM makes it worse: pages are constantly evicted and re-read from the stick, so the bad sectors get hit much more often, especially under load (rolling updates, startup).

Why could I still log in? Only a tiny part of the stick is broken (1 bad sector out of ~60 million). `bash`/`sshd` live in healthy areas and stay in the RAM page cache. The big, frequently re-read k3s binary and images are what hit the bad spot. But flash wear spreads — the stick has to be replaced.

Current state (Nov 14): the Pi is left as is (no further `apply`). Nothing of value on it — all projects are on GitHub. Next: fresh install on new storage → see chapter 12.

**Learned**
- `SIGBUS` / `critical medium error` / `Sense Key 0x3, ASC 0x11` = **storage hardware failure**, not a software bug. Check `dmesg` early when processes crash randomly.
- Random crashes in *different* programs at *similar* spots (Go runtime) point to hardware (storage/RAM), not to the programs.
- Ruling things out is progress: checksum (binary OK) → throttling (OK) → overclock (none) → OOM (none) → disk errors (**found**). My first two guesses (corrupted binary, RAM) were wrong.
- USB sticks are made for occasional big writes, not for constant small writes (k3s datastore, logs). Use an SSD or a "High Endurance" SD card.
- A full disk can kill a whole cluster: DiskPressure → evictions → rejected pods → nothing runs.
- Crashing services + unlimited core dumps = disk bomb. Always cap `LimitCORE`.
- `vmstat` tells you *why* a machine is slow (CPU vs. RAM vs. disk); load average alone doesn't.
- Without resource limits, pods compete for RAM until the whole node thrashes. With limits, only the offending pod gets `OOMKilled`.
- `requests` = what the scheduler reserves, `limits` = hard ceiling (memory → kill, CPU → throttle).
- A Pi 3 with 1 GB RAM is the absolute minimum for k3s; k3s recommends 2 GB+ for a server node.
- Check what else runs on a box (`ps aux`, `systemctl list-units`) — old experiments keep eating resources.

### 12) Fresh Reinstall from Scratch (Nov 15, 2026)

Goal: replace the dead stick and rebuild the Pi cleanly. Planned for 30 minutes, took several hours — almost all of it storage/flashing trouble, not Kubernetes.

**What went wrong while flashing**
- **Wobbly USB hub:** I wrote and tested sticks through a hub with loose ports. Connection drops in the middle of a write can make the stick disconnect, leave half-written data, or make the controller lock itself.
- **SanDisk #2 locked itself read-only:** Passed a full H2testw test (28.7 GB, no errors), but after the next write Windows showed `IsReadOnly: True`, and `diskpart` → `attributes disk clear readonly` didn't stick. SanDisk controllers switch to permanent read-only when they detect problems (possibly triggered by the hub). Dead for writing.
- **Old Raspberry Pi Imager (v1.9.6):** Raspberry Pi OS Trixie uses **cloud-init** for first-boot setup. Imager 1.9.x still writes the old `firstrun.sh` format, so user, Wi-Fi and SSH settings were ignored. Fix: Imager **2.0.12**, which writes `user-data` + `network-config` to `bootfs`.
- **Verbatim stick:** The Pi never booted from it. The FritzBox showed **no failed Wi-Fi login attempts** at all — so it wasn't the Wi-Fi password, the Pi never got that far. The Pi 3B's USB boot code is picky about sticks.
- **Accidentally flashed the Desktop image** (`issue.txt` said `stage4`). Lite = `stage2`. For a headless server always pick **Raspberry Pi OS Lite (64-bit)** under "Raspberry Pi OS (other)".
- **Third SanDisk (same model), written directly at the PC (no hub), Lite 64-bit, Imager 2.0.12 → booted.**

**Diagnosis tricks without a monitor or LAN cable**
- **Ping TTL tells the OS:** Linux starts at 64, Windows at 128. I pinged `192.168.178.27` and got `ttl=127` → that was my own Windows PC, not the Pi.
- **Read `bootfs` on the PC:** `user-data` / `network-config` present = Imager settings were written. `issue.txt` shows which image (Lite vs. Desktop).
- **FritzBox → WLAN → "Erfolglose Anmeldeversuche":** empty list = the Pi never even tried to connect.
- **SSH host key changed** after reinstall → `ssh-keygen -R <host>` before connecting again.
- **HDMI to the TV** finally showed the truth: the Pi had booted fine (`raspberrypi login:` + cloud-init messages). The steady green LED blink was *not* an error. Plug HDMI in **before** powering on.

**New setup (all in order)**
1. Imager 2.0.12: Pi 3 → Raspberry Pi OS **Lite (64-bit)** → hostname `raspberrypi`, user `toor`, Wi-Fi (2.4 GHz, country `DE`), SSH **public key only**.
2. `~/.ssh/config` in WSL: `Host rpi` → `Hostname raspberrypi.fritz.box`, `User toor` (hostname instead of fixed IP).
3. `sudo apt update && sudo apt full-upgrade -y` (44 packages, new kernel 6.18.60).
4. Flash-friendly journald (keep logs persistent — they were essential for the post-mortem — but limit size and writes):
   ```ini
   # /etc/systemd/journald.conf.d/flash-friendly.conf
   [Journal]
   SystemMaxUse=64M
   SyncIntervalSec=5m
   ```
   `noatime` was already set by Raspberry Pi OS.
5. Memory cgroup for k3s (append to the **single line** in `/boot/firmware/cmdline.txt`, make a `.bak` first): `cgroup_memory=1 cgroup_enable=memory`. `systemd.unified_cgroup_hierarchy=1` is no longer needed on Debian 13 (cgroup v2 only). Check: `cat /sys/fs/cgroup/cgroup.controllers` → contains `memory`.
6. **Before** installing k3s: `/etc/rancher/k3s/config.yaml` with `disable: [metrics-server]` and the `LimitCORE=0` drop-in in `/etc/systemd/system/k3s.service.d/`.
7. `curl -sfL https://get.k3s.io | sh -` → k3s **v1.37.2**.
8. Waited for Traefik (the repo contains a Traefik `Middleware`; that CRD only exists once Traefik is installed).
9. `git clone`, then `kubectl apply -k .` → 4 pods (flappy-bird, memory, pong, snake), Pong works in the browser.

**Dry-run gotcha:** On an empty cluster, `kubectl apply -k . --dry-run=server` fails with `namespaces "minigames" not found` for every object — the namespace is only created "pretend". Fix: `kubectl apply -f namespace.yaml` for real first, then dry-run. Same problem with CRDs that don't exist yet.

**sudo surprise:** `sudo -n true` worked from a second SSH session, so I thought `toor` had passwordless sudo. Wrong: `/etc/sudoers.d/010_global-tty` sets `Defaults timestamp_type=global`, so the password cached in my first session counted for all sessions. Real rule: `(ALL : ALL) ALL` with password. Kept it that way (SSH key + sudo password = two hurdles).

**Resources after the reinstall**

| | RAM used | available | swap used |
|---|---|---|---|
| Fresh Lite, no k3s | 163 MB | 741 MB | 0 |
| k3s v1.37 + 4 static games (~10 min after start) | 556 MB | 348 MB | 365 MB |

Right after startup `vmstat` still showed some swapping (`so` up to ~9,000 KB/s), but `b` = 0 and CPU mostly idle → no thrashing. To be re-checked once things have settled; if `so` stays high, scale one more game to 0.

**Learned**
- Use the **latest Imager**; old Imager + new OS = settings silently ignored.
- **Never write storage through a flaky hub.** Plug sticks directly into the PC.
- Debug in layers and gather evidence instead of guessing: TTL, `bootfs` contents, FritzBox log, then HDMI. A monitor would have saved two hours.
- Create the namespace before a server-side dry run on an empty cluster.
- Configure things **before** installing (k3s `config.yaml`, `LimitCORE`) instead of fixing them afterwards.
- This whole manual procedure is the reason for a follow-up project: describe the Pi as code (cloud-init + Ansible) so a dead stick means a 10-minute rebuild.

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
- **Random k3s/kubectl crashes (`SIGBUS`, `invalid runtime symbol table`)** → `dmesg` shows `critical medium error` → USB stick is dying, replace storage.
- **`git pull` fails with "divergent branches"** → `git pull --no-rebase origin main` (merge) or set `git config --global pull.rebase false`.
- **Imager settings (user, Wi-Fi, SSH) ignored on Trixie** → update Raspberry Pi Imager to 2.x (cloud-init).
- **Stick shows `IsReadOnly: True`, can't be cleared** → controller locked itself, stick is dead for writing.
- **Pi not found in the network** → check ping TTL (is it really the Pi?), `bootfs` contents, FritzBox failed-login list, then HDMI.
- **`--dry-run=server` says namespace not found** → create the namespace for real first.

## Things I Would Do Next
- ~~Replace the broken USB stick and reinstall.~~ Done (Nov 15, 2026), see chapter 12. Long-term: a "High Endurance" microSD or a small SSD instead of USB sticks.
- Check `dmesg | grep -i "medium error"` from time to time (new stick is the same SanDisk model as the dead one).
- Add a landing page that links to all games.
- ~~Add a simple scoreboard API with persistent storage.~~ Done (score API + redis), but scaled to 0 on the Pi 3.
- Add monitoring (basic `kubectl get pods -n minigames`).
- Add `readinessProbe` / `livenessProbe` to all Deployments.
- Pin image versions (`nginx:alpine` → fixed tag) and upgrade `node:18-alpine` (EOL) to `node:22-alpine`.
- Build real images with Dockerfiles + GitHub Actions (multi-arch) instead of mounting code via ConfigMaps.
- Move to stronger hardware (Pi 4/5 with 4–8 GB or a small cloud VM) to run the backends again.
- Make the games reachable from outside the LAN without opening router ports (Tailscale or Cloudflare Tunnel).
