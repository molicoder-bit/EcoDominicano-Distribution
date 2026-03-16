#!/usr/bin/env python3
import tkinter as tk
from tkinter import ttk, messagebox
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

# --- WhatsApp Functions ---
def wa_login():
    run_command("WhatsApp Login", "npm run whatsapp:login")

def wa_scan():
    run_command("Scan Groups", "npm run whatsapp:scan")

def wa_test_distribute():
    run_command("Test Distribution", "node scripts/distribute.js --test")

def wa_live_distribute():
    if messagebox.askyesno("Confirm Live Run", "Are you sure you want to run the LIVE distribution?\nThis will send real messages to groups."):
        run_command("LIVE Distribution", "npm run distribute")

# --- Placeholder Functions ---
def not_implemented(platform):
    messagebox.showinfo("Coming Soon", f"{platform} automation is not yet implemented.")

def main():
    root = tk.Tk()
    root.title("EcoDominicano Distributor")
    root.geometry("400x450")
    
    # Header
    header = tk.Label(root, text="EcoDominicano\nDistributor Control", font=("Arial", 14, "bold"))
    header.pack(pady=10)

    # Notebook (Tabs)
    notebook = ttk.Notebook(root)
    notebook.pack(expand=True, fill="both", padx=10, pady=5)

    # --- Tab 1: WhatsApp ---
    tab_wa = tk.Frame(notebook, bg="#f0f0f0")
    notebook.add(tab_wa, text="WhatsApp")

    tk.Label(tab_wa, text="WhatsApp Automation", font=("Arial", 10, "bold"), bg="#f0f0f0").pack(pady=10)
    
    tk.Button(tab_wa, text="1. Login / Scan QR", command=wa_login, height=2, bg="#e1f5fe", width=30).pack(pady=5)
    tk.Button(tab_wa, text="2. Scan Groups", command=wa_scan, height=2, bg="#e8f5e9", width=30).pack(pady=5)
    tk.Button(tab_wa, text="3. Test Distribution", command=wa_test_distribute, height=2, bg="#fff9c4", width=30).pack(pady=5)
    tk.Button(tab_wa, text="4. LIVE DISTRIBUTE", command=wa_live_distribute, height=2, bg="#ffcdd2", fg="#b71c1c", width=30).pack(pady=5)

    # --- Tab 2: Telegram ---
    tab_tg = tk.Frame(notebook, bg="#f0f0f0")
    notebook.add(tab_tg, text="Telegram")
    
    tk.Label(tab_tg, text="Telegram Automation", font=("Arial", 10, "bold"), bg="#f0f0f0").pack(pady=20)
    tk.Button(tab_tg, text="Login", command=lambda: not_implemented("Telegram"), height=2, width=30).pack(pady=5)
    tk.Button(tab_tg, text="Distribute", command=lambda: not_implemented("Telegram"), height=2, width=30).pack(pady=5)

    # --- Tab 3: Instagram ---
    tab_ig = tk.Frame(notebook, bg="#f0f0f0")
    notebook.add(tab_ig, text="Instagram")
    
    tk.Label(tab_ig, text="Instagram Automation", font=("Arial", 10, "bold"), bg="#f0f0f0").pack(pady=20)
    tk.Button(tab_ig, text="Login", command=lambda: not_implemented("Instagram"), height=2, width=30).pack(pady=5)

    # --- Tab 4: Facebook ---
    tab_fb = tk.Frame(notebook, bg="#f0f0f0")
    notebook.add(tab_fb, text="Facebook")

    tk.Label(tab_fb, text="Facebook Automation", font=("Arial", 10, "bold"), bg="#f0f0f0").pack(pady=20)
    tk.Button(tab_fb, text="Login", command=lambda: not_implemented("Facebook"), height=2, width=30).pack(pady=5)

    # Footer
    tk.Label(root, text="v1.1 - VM Controller", font=("Arial", 8), fg="gray").pack(side="bottom", pady=5)

    root.mainloop()

if __name__ == "__main__":
    main()
