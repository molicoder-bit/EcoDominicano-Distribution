#!/usr/bin/env python3
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import subprocess
import threading
import re
import os
import json

# Configuration
PROJECT_DIR = "/opt/ecodominicano-distributor"
PLAYWRIGHT_PATH = "/opt/ms-playwright"
USER = "ecodist"
SESSION_PATH = f"{PROJECT_DIR}/state/browser-sessions/whatsapp"
SINGLETON_LOCK = f"{SESSION_PATH}/SingletonLock"

def browser_is_open():
    """Return True if a Chrome browser is holding the WhatsApp session open."""
    return os.path.exists(SINGLETON_LOCK)

def build_cmd(npm_cmd):
    return (
        f"xhost +local: >/dev/null 2>&1; "
        f"cd {PROJECT_DIR} && "
        f"sudo -u {USER} DISPLAY={os.environ.get('DISPLAY', ':0')} "
        f"PLAYWRIGHT_BROWSERS_PATH={PLAYWRIGHT_PATH} {npm_cmd}"
    )

def open_terminal(title, cmd):
    """Open a gnome-terminal with a command (for interactive tasks like login)."""
    full_cmd = f"{cmd}; echo; read -p 'Done. Press Enter to close...'"
    try:
        subprocess.Popen(["gnome-terminal", "--title", title, "--", "bash", "-c", full_cmd])
    except Exception as e:
        messagebox.showerror("Error", f"Failed to open terminal:\n{e}")

def run_in_background(cmd, on_line=None, on_done=None):
    """Run a shell command in a background thread, calling on_line for each line."""
    env = os.environ.copy()
    env["PLAYWRIGHT_BROWSERS_PATH"] = PLAYWRIGHT_PATH

    def worker():
        proc = subprocess.Popen(
            ["bash", "-c", cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env
        )
        for line in proc.stdout:
            if on_line:
                on_line(line.rstrip())
        proc.wait()
        if on_done:
            on_done(proc.returncode)

    t = threading.Thread(target=worker, daemon=True)
    t.start()

# ─────────────────────────────────────────────
#  WHATSAPP TAB
# ─────────────────────────────────────────────
def get_platform_status():
    """Call platform-status.js and return parsed JSON, or {} on error."""
    try:
        cmd = build_cmd("node scripts/platform-status.js")
        result = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=15)
        return json.loads(result.stdout)
    except Exception:
        return {}

def build_whatsapp_tab(parent):
    frame = tk.Frame(parent, bg="#f5f5f5")

    # ── Daily status bar ──────────────────────────────────────────────────
    status_frame = tk.Frame(frame, bg="#f5f5f5")
    status_frame.pack(fill="x", padx=15, pady=(8, 0))

    indicator_label = tk.Label(status_frame, text="⬤", font=("Arial", 14), bg="#f5f5f5", fg="gray")
    indicator_label.pack(side="left")
    daily_status_var = tk.StringVar(value="Loading status...")
    tk.Label(status_frame, textvariable=daily_status_var, font=("Arial", 9), bg="#f5f5f5", fg="#444").pack(side="left", padx=6)
    refresh_btn = tk.Button(status_frame, text="↻", font=("Arial", 10), bg="#f5f5f5", relief="flat",
                            command=lambda: refresh_status())
    refresh_btn.pack(side="right")

    def refresh_status():
        daily_status_var.set("Checking...")
        indicator_label.config(fg="gray")
        def worker():
            data = get_platform_status()
            wa = data.get("whatsappWeb", {})
            color = {"green": "#2e7d32", "yellow": "#f57f17", "red": "#c62828"}.get(wa.get("status"), "gray")
            text = wa.get("reason", "Status unavailable")
            sent = wa.get("groupsSentToday", [])
            indicator_label.config(fg=color)
            daily_status_var.set(text)
            if sent:
                sent_list.delete(0, tk.END)
                for g in sent:
                    sent_list.insert(tk.END, f"  ✓ {g}")
        threading.Thread(target=worker, daemon=True).start()

    # Status bar at bottom
    status_var = tk.StringVar(value="Ready")
    status_label = tk.Label(frame, textvariable=status_var, font=("Arial", 9, "italic"), bg="#f5f5f5", fg="gray")
    status_label.pack(anchor="w", padx=15, pady=(2, 0))

    # Button row
    btn_frame = tk.Frame(frame, bg="#f5f5f5")
    btn_frame.pack(fill="x", padx=15, pady=8)

    scan_status = tk.Label(btn_frame, text="", font=("Arial", 12), bg="#f5f5f5")
    test_status = tk.Label(btn_frame, text="", font=("Arial", 12), bg="#f5f5f5")
    live_status = tk.Label(btn_frame, text="", font=("Arial", 12), bg="#f5f5f5")

    def do_login():
        open_terminal("WhatsApp Login", build_cmd("npm run whatsapp:login"))
        status_var.set("Browser opened — scan QR, then CLOSE the browser window before scanning groups.")
        # Poll until login browser is closed, then re-enable scan button
        def watch_for_close():
            import time
            while browser_is_open():
                time.sleep(1)
            # Browser closed — session is saved
            scan_btn.config(state="normal")
            status_var.set("Login browser closed. Session saved. You can now scan groups.")
        threading.Thread(target=watch_for_close, daemon=True).start()
        scan_btn.config(state="disabled")
        scan_status.config(text="🔒", fg="gray")

    def do_scan():
        if browser_is_open():
            messagebox.showwarning(
                "Browser Still Open",
                "The login browser is still open.\n\n"
                "Please close the WhatsApp browser window first,\n"
                "then click Scan Groups again."
            )
            return
        scan_btn.config(state="disabled")
        scan_status.config(text="⏳", fg="orange")
        groups_list.delete(0, tk.END)
        log_box.config(state="normal")
        log_box.delete("1.0", tk.END)
        status_var.set("Scanning groups — browser will open, please wait...")

        found_names = []

        def on_line(line):
            log_box.config(state="normal")
            log_box.insert(tk.END, line + "\n")
            log_box.see(tk.END)
            log_box.config(state="disabled")

            if "whatsapp_browser_still_open" in line:
                status_var.set("Close the WhatsApp browser window, then run Scan Groups again.")

            # Parse: "Found 5 groups: Group A, Group B, Group C"
            m = re.search(r'Found \d+ groups?: (.+)', line)
            if m:
                names = [n.strip() for n in m.group(1).split(',') if n.strip()]
                found_names.clear()
                found_names.extend(names)
                groups_list.delete(0, tk.END)
                for i, name in enumerate(found_names, 1):
                    groups_list.insert(tk.END, f"  {i}. {name}")

        def on_done(returncode):
            scan_btn.config(state="normal")
            if found_names:
                scan_status.config(text="✅", fg="green")
                status_var.set(f"Scan complete — {len(found_names)} groups ready.")
                distribute_btn.config(state="normal")
                test_btn.config(state="normal")
            else:
                scan_status.config(text="❌", fg="red")
                status_var.set("Scan failed or no groups found. Check the log below.")

        run_in_background(build_cmd("npm run whatsapp:scan"), on_line=on_line, on_done=on_done)

    def do_test():
        test_status.config(text="⏳", fg="orange")
        test_btn.config(state="disabled")
        distribute_btn.config(state="disabled")
        status_var.set("Running test distribution...")
        log_box.config(state="normal")
        log_box.delete("1.0", tk.END)

        def on_line(line):
            log_box.config(state="normal")
            log_box.insert(tk.END, line + "\n")
            log_box.see(tk.END)
            log_box.config(state="disabled")

        def on_done(returncode):
            test_btn.config(state="normal")
            distribute_btn.config(state="normal")
            if returncode == 0:
                test_status.config(text="✅", fg="green")
                status_var.set("Test complete!")
            else:
                test_status.config(text="❌", fg="red")
                status_var.set("Test failed. Check the log.")

        run_in_background(build_cmd("node scripts/distribute.js --test --platform=whatsappWeb"), on_line=on_line, on_done=on_done)

    def do_live():
        if not messagebox.askyesno("Confirm LIVE Run", "Send REAL messages to groups now?"):
            return
        live_status.config(text="⏳", fg="orange")
        test_btn.config(state="disabled")
        distribute_btn.config(state="disabled")
        status_var.set("Running LIVE distribution...")
        log_box.config(state="normal")
        log_box.delete("1.0", tk.END)

        def on_line(line):
            log_box.config(state="normal")
            log_box.insert(tk.END, line + "\n")
            log_box.see(tk.END)
            log_box.config(state="disabled")

        def on_done(returncode):
            test_btn.config(state="normal")
            distribute_btn.config(state="normal")
            if returncode == 0:
                live_status.config(text="✅", fg="green")
                status_var.set("LIVE distribution complete!")
            else:
                live_status.config(text="❌", fg="red")
                status_var.set("Distribution failed. Check the log.")
            refresh_status()

        run_in_background(build_cmd("node scripts/distribute.js --platform=whatsappWeb"), on_line=on_line, on_done=on_done)

    # Buttons
    login_btn  = tk.Button(btn_frame, text="1. Login / Scan QR",   command=do_login, width=22, height=2, bg="#e1f5fe")
    scan_btn   = tk.Button(btn_frame, text="2. Scan Groups",        command=do_scan,  width=22, height=2, bg="#e8f5e9")
    test_btn   = tk.Button(btn_frame, text="3. Test Distribution",  command=do_test,  width=22, height=2, bg="#fff9c4", state="disabled")
    distribute_btn = tk.Button(btn_frame, text="4. LIVE DISTRIBUTE", command=do_live, width=22, height=2, bg="#ffcdd2", fg="#b71c1c", state="disabled")

    # Layout buttons with status icons
    for i, (btn, icon_lbl) in enumerate([
        (login_btn,      tk.Label(btn_frame, text="", bg="#f5f5f5")),
        (scan_btn,       scan_status),
        (test_btn,       test_status),
        (distribute_btn, live_status),
    ]):
        btn.grid(row=i, column=0, sticky="w", pady=3)
        icon_lbl.grid(row=i, column=1, padx=8)

    # Groups list (top 5 by recent activity)
    tk.Label(frame, text="Top 5 groups (most recent activity):", font=("Arial", 9, "bold"), bg="#f5f5f5").pack(anchor="w", padx=15, pady=(5, 0))
    groups_list = tk.Listbox(frame, height=8, font=("Courier", 9), bg="white")
    groups_list.pack(fill="x", padx=15, pady=(2, 2))

    # Already sent today
    tk.Label(frame, text="Already sent today:", font=("Arial", 9, "bold"), bg="#f5f5f5").pack(anchor="w", padx=15)
    sent_list = tk.Listbox(frame, height=3, font=("Courier", 9), bg="#f9fbe7")
    sent_list.pack(fill="x", padx=15, pady=(2, 5))

    # Log output
    tk.Label(frame, text="Log:", font=("Arial", 9, "bold"), bg="#f5f5f5").pack(anchor="w", padx=15)
    log_box = scrolledtext.ScrolledText(frame, height=8, font=("Courier", 8), state="disabled", bg="#1e1e1e", fg="#cccccc")
    log_box.pack(fill="both", expand=True, padx=15, pady=(2, 10))

    # Refresh status on load and after distribute completes
    frame.after(500, refresh_status)

    # Patch on_done for live/test to also refresh status
    _orig_live_on_done = None  # placeholder; refresh_status already callable in scope

    return frame

# ─────────────────────────────────────────────
#  TELEGRAM TAB
# ─────────────────────────────────────────────
def build_telegram_tab(parent):
    frame = tk.Frame(parent, bg="#f5f5f5")

    # ── Daily status bar ──────────────────────────────────────────────────
    tg_status_frame = tk.Frame(frame, bg="#f5f5f5")
    tg_status_frame.pack(fill="x", padx=15, pady=(8, 0))
    tg_indicator = tk.Label(tg_status_frame, text="⬤", font=("Arial", 14), bg="#f5f5f5", fg="gray")
    tg_indicator.pack(side="left")
    tg_daily_var = tk.StringVar(value="Loading status...")
    tk.Label(tg_status_frame, textvariable=tg_daily_var, font=("Arial", 9), bg="#f5f5f5", fg="#444").pack(side="left", padx=6)
    tk.Button(tg_status_frame, text="↻", font=("Arial", 10), bg="#f5f5f5", relief="flat",
              command=lambda: tg_refresh_status()).pack(side="right")

    def tg_refresh_status():
        tg_daily_var.set("Checking...")
        tg_indicator.config(fg="gray")
        def worker():
            data = get_platform_status()
            tg = data.get("telegram", {})
            color = {"green": "#2e7d32", "yellow": "#f57f17", "red": "#c62828"}.get(tg.get("status"), "gray")
            tg_indicator.config(fg=color)
            tg_daily_var.set(tg.get("reason", "Status unavailable"))
            sent = tg.get("groupsSentToday", [])
            tg_sent_list.delete(0, tk.END)
            for g in sent:
                tg_sent_list.insert(tk.END, f"  ✓ {g}")
        threading.Thread(target=worker, daemon=True).start()

    tg_status_var = tk.StringVar(value="Ready")
    tk.Label(frame, textvariable=tg_status_var, font=("Arial", 9, "italic"), bg="#f5f5f5", fg="gray").pack(anchor="w", padx=15, pady=(2, 0))

    # ── Buttons ───────────────────────────────────────────────────────────
    btn_frame = tk.Frame(frame, bg="#f5f5f5")
    btn_frame.pack(anchor="w", padx=15, pady=4)

    tg_scan_status = tk.Label(btn_frame, text="", font=("Arial", 12), bg="#f5f5f5")
    tg_test_status = tk.Label(btn_frame, text="", font=("Arial", 12), bg="#f5f5f5")
    tg_live_status = tk.Label(btn_frame, text="", font=("Arial", 12), bg="#f5f5f5")

    def do_tg_login():
        tg_status_var.set("Opening Telegram login terminal — enter the OTP code when prompted.")
        open_terminal("Telegram Login", build_cmd("npm run telegram:login"))

    def do_tg_scan():
        tg_scan_btn.config(state="disabled")
        tg_scan_status.config(text="⏳", fg="orange")
        tg_groups_list.delete(0, tk.END)
        tg_log_box.config(state="normal")
        tg_log_box.delete("1.0", tk.END)
        tg_status_var.set("Scanning Telegram groups...")
        found_names = []

        def on_line(line):
            tg_log_box.config(state="normal")
            tg_log_box.insert(tk.END, line + "\n")
            tg_log_box.see(tk.END)
            tg_log_box.config(state="disabled")
            m = re.search(r'Found \d+ groups?: (.+)', line)
            if m:
                names = [n.strip() for n in m.group(1).split(',') if n.strip()]
                found_names.clear()
                found_names.extend(names)
                tg_groups_list.delete(0, tk.END)
                for i, name in enumerate(found_names, 1):
                    tg_groups_list.insert(tk.END, f"  {i}. {name}")

        def on_done(returncode):
            tg_scan_btn.config(state="normal")
            if found_names:
                tg_scan_status.config(text="✅", fg="green")
                tg_status_var.set(f"Scan complete — {len(found_names)} groups found.")
                tg_test_btn.config(state="normal")
                tg_live_btn.config(state="normal")
            else:
                tg_scan_status.config(text="❌", fg="red")
                tg_status_var.set("No groups found. Check login or log below.")

        run_in_background(build_cmd("npm run telegram:scan"), on_line=on_line, on_done=on_done)

    def do_tg_test():
        tg_test_status.config(text="⏳", fg="orange")
        tg_test_btn.config(state="disabled")
        tg_live_btn.config(state="disabled")
        tg_status_var.set("Running Telegram test distribution...")
        tg_log_box.config(state="normal")
        tg_log_box.delete("1.0", tk.END)

        def on_line(line):
            tg_log_box.config(state="normal")
            tg_log_box.insert(tk.END, line + "\n")
            tg_log_box.see(tk.END)
            tg_log_box.config(state="disabled")

        def on_done(returncode):
            tg_test_btn.config(state="normal")
            tg_live_btn.config(state="normal")
            if returncode == 0:
                tg_test_status.config(text="✅", fg="green")
                tg_status_var.set("Telegram test complete!")
            else:
                tg_test_status.config(text="❌", fg="red")
                tg_status_var.set("Telegram test failed. Check the log.")

        run_in_background(build_cmd("node scripts/distribute.js --test --platform=telegram"), on_line=on_line, on_done=on_done)

    def do_tg_live():
        if not messagebox.askyesno("Confirm LIVE Telegram Run", "Send REAL messages to Telegram groups and channel now?"):
            return
        tg_live_status.config(text="⏳", fg="orange")
        tg_test_btn.config(state="disabled")
        tg_live_btn.config(state="disabled")
        tg_status_var.set("Running LIVE Telegram distribution...")
        tg_log_box.config(state="normal")
        tg_log_box.delete("1.0", tk.END)

        def on_line(line):
            tg_log_box.config(state="normal")
            tg_log_box.insert(tk.END, line + "\n")
            tg_log_box.see(tk.END)
            tg_log_box.config(state="disabled")

        def on_done(returncode):
            tg_test_btn.config(state="normal")
            tg_live_btn.config(state="normal")
            if returncode == 0:
                tg_live_status.config(text="✅", fg="green")
                tg_status_var.set("Telegram LIVE distribution complete!")
            else:
                tg_live_status.config(text="❌", fg="red")
                tg_status_var.set("Telegram distribution failed. Check the log.")
            tg_refresh_status()

        run_in_background(build_cmd("node scripts/distribute.js --platform=telegram"), on_line=on_line, on_done=on_done)

    tg_login_btn = tk.Button(btn_frame, text="1. Login (one-time)", command=do_tg_login, width=22, height=2, bg="#e1f5fe")
    tg_scan_btn  = tk.Button(btn_frame, text="2. Scan Groups",      command=do_tg_scan,  width=22, height=2, bg="#e8f5e9")
    tg_test_btn  = tk.Button(btn_frame, text="3. Test Distribution",command=do_tg_test,  width=22, height=2, bg="#fff9c4", state="disabled")
    tg_live_btn  = tk.Button(btn_frame, text="4. LIVE DISTRIBUTE",  command=do_tg_live,  width=22, height=2, bg="#ffcdd2", fg="#b71c1c", state="disabled")

    for i, (btn, icon_lbl) in enumerate([
        (tg_login_btn, tk.Label(btn_frame, text="", bg="#f5f5f5")),
        (tg_scan_btn,  tg_scan_status),
        (tg_test_btn,  tg_test_status),
        (tg_live_btn,  tg_live_status),
    ]):
        btn.grid(row=i, column=0, sticky="w", pady=3)
        icon_lbl.grid(row=i, column=1, padx=8)

    # Groups list
    tk.Label(frame, text="Top groups (most recent activity):", font=("Arial", 9, "bold"), bg="#f5f5f5").pack(anchor="w", padx=15, pady=(5, 0))
    tg_groups_list = tk.Listbox(frame, height=8, font=("Courier", 9), bg="white")
    tg_groups_list.pack(fill="x", padx=15, pady=(2, 2))

    # Already sent today
    tk.Label(frame, text="Already sent today:", font=("Arial", 9, "bold"), bg="#f5f5f5").pack(anchor="w", padx=15)
    tg_sent_list = tk.Listbox(frame, height=3, font=("Courier", 9), bg="#f9fbe7")
    tg_sent_list.pack(fill="x", padx=15, pady=(2, 5))

    # Log
    tk.Label(frame, text="Log:", font=("Arial", 9, "bold"), bg="#f5f5f5").pack(anchor="w", padx=15)
    tg_log_box = scrolledtext.ScrolledText(frame, height=8, font=("Courier", 8), state="disabled", bg="#1e1e1e", fg="#cccccc")
    tg_log_box.pack(fill="both", expand=True, padx=15, pady=(2, 10))

    frame.after(500, tg_refresh_status)
    return frame

# ─────────────────────────────────────────────
#  PLACEHOLDER TABS
# ─────────────────────────────────────────────
def build_placeholder_tab(parent, platform):
    frame = tk.Frame(parent, bg="#f5f5f5")
    tk.Label(frame, text=f"{platform} automation\nnot yet implemented.",
             font=("Arial", 12), bg="#f5f5f5", fg="gray").pack(expand=True)
    return frame

# ─────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────
def main():
    root = tk.Tk()
    root.title("EcoDominicano Distributor")
    root.geometry("560x600")
    root.resizable(True, True)

    tk.Label(root, text="EcoDominicano Distributor", font=("Arial", 14, "bold")).pack(pady=8)

    notebook = ttk.Notebook(root)
    notebook.pack(expand=True, fill="both", padx=8, pady=4)

    notebook.add(build_whatsapp_tab(notebook),  text="  WhatsApp  ")
    notebook.add(build_telegram_tab(notebook),  text="  Telegram  ")
    notebook.add(build_placeholder_tab(notebook, "Instagram"), text="  Instagram ")
    notebook.add(build_placeholder_tab(notebook, "Facebook"),  text="  Facebook  ")

    tk.Label(root, text="v1.2", font=("Arial", 7), fg="gray").pack(side="bottom", pady=2)

    root.mainloop()

if __name__ == "__main__":
    main()
