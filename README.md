# EcoDominicano Distribution

Automated content distribution from EcoDominicano to owned channels and external platforms such as Telegram, Facebook, Reddit, WhatsApp, email newsletters, web push, and other discovery channels.

## VM Access

Run the distributor inside the Ubuntu VM so the main PC does not get cluttered with browser automation tooling, scheduled jobs, and runtime dependencies.

Use this command from the Windows host:

```powershell
ssh ubuntu-vm
# or: ssh -i $env:USERPROFILE\.ssh\ecodominicano_vm lmolina@192.168.12.108
```

## VM Setup (one-time)

If Node.js is not yet installed on the VM, run:

```bash
# Wait for any running apt processes to finish, then:
sudo apt-get update && sudo apt-get install -y nodejs npm

# Or install Node 20 via tarball:
# sudo mkdir -p /opt/node && curl -sL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz | sudo tar -xJ -C /opt/node --strip-components=1 && sudo ln -sf /opt/node/bin/node /usr/local/bin/node && sudo ln -sf /opt/node/bin/npm /usr/local/bin/npm
```

Then verify: `sudo -u ecodist /opt/ecodominicano-distributor/run-distribute.sh`

## Documentation

**[Technical Implementation Plan](docs/TECHNICAL_IMPLEMENTATION_PLAN.md)** — Full deployment and automation blueprint.

## Quick Start

1. Provision Ubuntu VM
2. Follow [Deployment Steps](docs/TECHNICAL_IMPLEMENTATION_PLAN.md#5-deployment-steps) in the technical plan
3. Configure `config/.env` from `config/.env.example`
4. Configure `config/settings.json` from `config/settings.example.json`
5. Run `npm run distribute` for manual run, or enable the daily systemd timer

## Structure

```
/opt/ecodominicano-distributor/
├── config/       # .env, settings, templates
├── scripts/      # Fetch, distribute, platform modules
├── data/         # SQLite tracking database
├── state/        # Sessions, locks, debug exports
├── logs/         # Rotated logs, failed posts
└── deploy/       # systemd units
```
