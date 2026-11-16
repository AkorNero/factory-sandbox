# Host setup

How the Day Planner server's host is set up: a Windows PC running Ubuntu under WSL2, private over Tailscale. The reasons for this setup are in [ADR 0001](adr/0001-self-hosted-powersync-on-wsl2.md). This page is the how.

Two setups are documented:

- **[A. Docker Desktop](#a-docker-desktop-in-use)**: **in use.** Less setup, but the server only runs while you're logged in to Windows.
- **[B. Docker Engine inside WSL](#b-docker-engine-inside-wsl-not-in-use)**: not in use. More setup, no Docker Desktop, and the app is started by systemd.

Everything from step 3 on (Tailscale, `tailscale serve`, devices) is the same for both.

The values used throughout:

| Thing | Value |
|---|---|
| WSL distro | `Ubuntu` |
| Tailscale machine name | `dayplanner` |
| App address | `https://dayplanner.<tailnet>.ts.net` (currently `https://dayplanner.tail46380e.ts.net`) |
| Port the Node API listens on inside WSL | `127.0.0.1:8080` |

---

## A. Docker Desktop (in use)

### A1. WSL2 with systemd

Tailscale runs as a systemd service inside Ubuntu, so systemd must be on.

`/etc/wsl.conf` inside Ubuntu:

```ini
[boot]
systemd=true
```

**Check:** `ps -p 1 -o comm=` prints `systemd`.

### A2. Docker Desktop starts at sign-in

In Docker Desktop:

1. **Settings → General**: tick **Start Docker Desktop when you sign in to your computer**.
2. **Settings → Resources → WSL integration**: **Ubuntu** on.
3. **Apply & restart**.

Every service in the app's compose file has `restart: unless-stopped`, so the app comes back up whenever Docker Desktop starts. There is no systemd unit for the app.

**Check:** `docker info --format '{{.OperatingSystem}}'` inside Ubuntu prints `Docker Desktop`.

### A3. Keep Ubuntu running

By default WSL shuts a distro down a few seconds after its last terminal closes, which would take Tailscale with it. Two parts fix that.

**Never shut down when idle.** `C:\Users\<you>\.wslconfig` on Windows:

```ini
[general]
# Never shut Ubuntu down when idle (Day Planner server + Tailscale live here)
instanceIdleTimeout=-1

[wsl2]
# Never stop the WSL VM when idle
vmIdleTimeout=-1
```

`instanceIdleTimeout` needs a recent WSL (`wsl --version`; this was set up on 3.0.5).

**Start Ubuntu at sign-in.** Run in **PowerShell as Administrator**:

```powershell
$action  = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu --exec /bin/true"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName "Start WSL Ubuntu" -Action $action -Trigger $trigger -Description "Starts Ubuntu at logon for the Day Planner server and Tailscale"
```

A console window may flash briefly at sign-in; that's this task.

**Apply:** run `wsl --shutdown` in PowerShell, then open Ubuntu again. This ends anything running in WSL.

**Check:** in PowerShell, `Get-ScheduledTask -TaskName "Start WSL Ubuntu"` shows `Ready`. After closing every Ubuntu terminal and waiting a minute, `wsl -l -v` still shows Ubuntu as `Running`.

Continue with [step 3](#3-tailscale-inside-ubuntu).

---

## B. Docker Engine inside WSL (not in use)

Use this setup to drop Docker Desktop. The app is then started by systemd inside Ubuntu, so it doesn't depend on Docker Desktop. Ubuntu itself must still be started, by the same logon task as A3.

### B1. WSL2 with systemd

Same as [A1](#a1-wsl2-with-systemd).

### B2. Turn off Docker Desktop's WSL integration

If Docker Desktop is installed, go to **Settings → Resources → WSL integration**, turn **Ubuntu off**, and **Apply & restart**. Otherwise its `docker` command and socket clash with Docker Engine. Docker Desktop can stay installed for other uses on Windows.

### B3. Install Docker Engine

Docker's official apt repository, inside Ubuntu:

```bash
# Docker's GPG key
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# The repository
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update

# Engine + compose
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # then open a new terminal
```

If `apt update` can't find a release for a very new Ubuntu version, check Docker's install page for which Ubuntu versions are supported.

**Check:** `docker info --format '{{.OperatingSystem}}'` prints `Ubuntu …`, and `docker compose version` works.

### B4. Start the app at boot

Even with `restart: unless-stopped`, a systemd unit makes sure the app starts with Ubuntu, including after a `docker compose down`. `/etc/systemd/system/dayplanner.service`:

```ini
[Unit]
Description=Day Planner server (docker compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/the/compose/project
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dayplanner
```

**Check:** `systemctl status dayplanner` shows `active (exited)` and `docker compose ps` lists the services.

### B5. Keep Ubuntu running

Same as [A3](#a3-keep-ubuntu-running): the `.wslconfig` and the logon task. To start Ubuntu without signing in to Windows, edit the task in Task Scheduler: set its trigger to **At startup** and choose **Run whether user is logged on or not**.

Continue with step 3.

---

## 3. Tailscale inside Ubuntu

Tailscale runs **inside Ubuntu**, not on Windows, so the address points straight at WSL. Installing Tailscale on Windows too, as a client, is fine.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
sudo tailscale up --hostname=dayplanner
```

Open the login URL that `tailscale up` prints and sign in.

In the Tailscale admin console (login.tailscale.com):

1. **Machines → dayplanner → … → Disable key expiry.** Otherwise the server drops off the tailnet every 180 days.
2. **DNS**: **MagicDNS** on, then **HTTPS Certificates** on.

Let your own user manage `tailscale serve` without `sudo`:

```bash
sudo tailscale set --operator=$USER
```

**Check:** `tailscale status` lists `dayplanner` as online.

## 4. Publish the app on the tailnet

```bash
tailscale serve --bg 8080
```

This forwards `https://dayplanner.<tailnet>.ts.net/` to `http://127.0.0.1:8080`. `--bg` keeps it across restarts. The app's Node API must listen on that port, and anything else the browser needs (such as the PowerSync endpoint) goes through the same address.

**Funnel stays off.** The app has no login screen and relies on only tailnet devices being able to reach it. Turning Funnel on, or exposing it publicly any other way, requires adding real auth first ([ADR 0001](adr/0001-self-hosted-powersync-on-wsl2.md)).

**Check:** `tailscale serve status` shows `(tailnet only)` and `/ proxy http://127.0.0.1:8080`.

To test before the app exists:

```bash
mkdir -p /tmp/servetest && echo ok > /tmp/servetest/index.html
python3 -m http.server 8080 --bind 127.0.0.1 --directory /tmp/servetest
# from another device on the tailnet: open https://dayplanner.<tailnet>.ts.net → "ok"
# Ctrl+C to stop
```

## 5. Devices

On the phone and the desktop:

1. Install Tailscale and sign in with the **same account**. On the phone, turn the VPN on.
2. Open `https://dayplanner.<tailnet>.ts.net`.
3. Install the PWA: **Share → Add to Home Screen** in iPhone Safari, **Install app** in Android Chrome, or the install icon in the address bar on desktop.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Address loads but shows an error page | Nothing is listening on 8080 | (A) Is Docker Desktop running? Run `docker compose ps` in the project. (B) Run `systemctl status dayplanner`. |
| Address doesn't load at all | Ubuntu or Tailscale is down, or the device isn't on the tailnet | Check the device's Tailscale is connected. On the PC: `wsl -l -v` shows Ubuntu `Running`; inside Ubuntu, `tailscale status`. |
| Works, then stops after closing the terminal | `.wslconfig` not applied | Check the file and run `wsl --shutdown` once. |
| Nothing works after a reboot until a terminal is opened | Logon task missing or disabled | `Get-ScheduledTask -TaskName "Start WSL Ubuntu"`. |
| Certificate error | HTTPS Certificates off in the Tailscale admin console | Turn it on, then rerun `tailscale serve --bg 8080`. |
| `dayplanner` dropped off the tailnet months later | Key expiry was left on | Re-authenticate with `sudo tailscale up` and disable key expiry. |
| Edits don't sync between devices | Server down (see above) | Edits queue on each device and sync once the server is back; no action is needed on the devices. |

## What isn't covered

- **Backups**: there are none, an accepted risk ([ADR 0001](adr/0001-self-hosted-powersync-on-wsl2.md)).
- **The app's compose file, schema and PowerSync config**: those live with the code, built in the first ticket ("Add a Task on one device and see it on the other").
