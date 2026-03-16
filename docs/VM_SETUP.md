# VM Setup & Deployment Guide

This guide explains how to set up the EcoDominicano Distributor on a fresh Ubuntu VM.

## 1. Prerequisites (VM Side)

Run these commands on the VM to install necessary system dependencies:

```bash
sudo apt-get update
sudo apt-get install -y \
    nodejs \
    npm \
    git \
    xvfb \
    python3-tk \
    gnome-terminal \
    libgbm1 \
    libasound2 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2
```

## 2. User Setup

Create the application user `ecodist` if it doesn't exist:

```bash
sudo useradd -m -s /bin/bash ecodist
sudo usermod -aG sudo ecodist  # Optional: if ecodist needs sudo (usually not for running scripts)
```

## 3. Project Deployment

The project lives in `/opt/ecodominicano-distributor`.

1. **Copy files:**
   Copy the entire repository content to `/opt/ecodominicano-distributor`.

2. **Permissions:**
   Ensure `ecodist` owns the directory:
   ```bash
   sudo chown -R ecodist:ecodist /opt/ecodominicano-distributor
   ```

3. **Install Dependencies:**
   ```bash
   cd /opt/ecodominicano-distributor
   sudo -u ecodist npm install
   ```

4. **Install Playwright Browsers:**
   We use a shared location for browsers: `/opt/ms-playwright`.
   ```bash
   sudo mkdir -p /opt/ms-playwright
   sudo chown ecodist:ecodist /opt/ms-playwright
   sudo -u ecodist PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright npx playwright install chromium
   ```

## 4. Desktop GUI Setup (For User `lmolina`)

To enable the graphical launcher on the desktop:

1. **Install the Launcher Script:**
   The launcher script is at `scripts/gui-launcher.py`. Ensure it is executable:
   ```bash
   sudo chmod +x /opt/ecodominicano-distributor/scripts/gui-launcher.py
   ```

2. **Create Desktop Shortcut:**
   Create a file named `EcoDistributor.desktop` on the user's desktop (e.g., `/home/lmolina/Desktop/`):

   ```ini
   [Desktop Entry]
   Version=1.0
   Type=Application
   Name=EcoDominicano Distributor
   Comment=Control Panel for WhatsApp Distribution
   Exec=/opt/ecodominicano-distributor/scripts/gui-launcher.py
   Icon=utilities-terminal
   Terminal=false
   Categories=Utility;
   ```

3. **Trust the Shortcut:**
   Right-click the icon on the desktop and select **"Allow Launching"**.

## 5. Environment Variables

Ensure `.env` is set up in `/opt/ecodominicano-distributor/config/.env`.
Refer to `.env.example` in the repo.

## 6. Troubleshooting

- **"Authorization required" / Display errors:**
  The launcher automatically runs `xhost +local:` to allow the `ecodist` user to show windows on the current user's desktop.
- **Browser not opening:**
  Check `PLAYWRIGHT_BROWSERS_PATH` is set correctly in the scripts.
