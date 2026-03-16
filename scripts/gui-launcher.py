#!/usr/bin/env python3
import tkinter as tk
from tkinter import messagebox
import subprocess
import os
import sys

# Configuration
PROJECT_DIR = "/opt/ecodominicano-distributor"
PLAYWRIGHT_PATH = "/opt/ms-playwright"
USER = "ecodist"

def run_command(title, cmd):
    """Run a command in a new gnome-terminal window."""
    # We use 'bash -c' to run the command and then pause so the user can see the output
    full_command = (
        f"xhost +local: >/dev/null 2>&1; "
        f"cd {PROJECT_DIR} && "
        f"sudo -u {USER} DISPLAY=$DISPLAY PLAYWRIGHT_BROWSERS_PATH={PLAYWRIGHT_PATH} {cmd}; "
        f"echo; read -p 'Done. Press Enter to close...' "
    )
    
    # Launch gnome-terminal
    try:
        subprocess.Popen(
            ["gnome-terminal", "--title", title, "--", "bash", "-c", full_command]
        )
    except FileNotFoundError:
        messagebox.showerror("Error", "gnome-terminal not found. Please install it.")
    except Exception as e:
        messagebox.showerror("Error", f"Failed to launch terminal:\n{e}")

def login():
    run_command("WhatsApp Login", "npm run whatsapp:login")

def scan():
    run_command("Scan Groups", "npm run whatsapp:scan")

def test_distribute():
    run_command("Test Distribution", "node scripts/distribute.js --test")

def live_distribute():
    if messagebox.askyesno("Confirm Live Run", "Are you sure you want to run the LIVE distribution?\nThis will send real messages to groups."):
        run_command("LIVE Distribution", "npm run distribute")

def main():
    root = tk.Tk()
    root.title("EcoDominicano Distributor")
    root.geometry("350x300")
    
    # Header
    header = tk.Label(root, text="EcoDominicano\nDistributor Control", font=("Arial", 14, "bold"))
    header.pack(pady=15)

    # Buttons
    btn_frame = tk.Frame(root)
    btn_frame.pack(pady=10, fill="x", padx=40)

    tk.Button(btn_frame, text="1. Login / Scan QR", command=login, height=2, bg="#e1f5fe").pack(fill="x", pady=5)
    tk.Button(btn_frame, text="2. Scan Groups", command=scan, height=2, bg="#e8f5e9").pack(fill="x", pady=5)
    tk.Button(btn_frame, text="3. Test Distribution", command=test_distribute, height=2, bg="#fff9c4").pack(fill="x", pady=5)
    tk.Button(btn_frame, text="4. LIVE DISTRIBUTE", command=live_distribute, height=2, bg="#ffcdd2", fg="#b71c1c").pack(fill="x", pady=5)

    # Footer
    tk.Label(root, text="v1.0 - VM Controller", font=("Arial", 8), fg="gray").pack(side="bottom", pady=5)

    root.mainloop()

if __name__ == "__main__":
    main()
