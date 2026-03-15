# EcoDominicano Distributor VM — Technical Implementation Plan

## Overview

This document defines the technical implementation plan for the **Distributor VM** — an isolated Ubuntu VM that automates content distribution from the EcoDominicano website to controlled channels such as Telegram, Facebook, Reddit, and selected WhatsApp workflows.

The primary scope of this document is the **Distributor VM and its operational workflow**. Over time, the overall project may expand into a broader growth, owned-channel, and publishing strategy, but the VM remains the core implementation focus for this plan.

---

## 1. System Architecture

### 1.1 Role of the VM

| Aspect | Description |
|--------|-------------|
| **Purpose** | Automated content distribution agent — fetches new articles, formats them, and posts to social platforms |
| **Isolation** | Runs on a dedicated VM, separate from the web server. No direct DB access; communicates via HTTP/API only |
| **Scope** | Daily scheduling, content fetching, platform eligibility checks, formatting, posting, logging, retry handling, anti-ban policy enforcement |

### 1.2 Interaction with EcoDominicano Website

```
┌─────────────────────┐         HTTP/HTTPS          ┌──────────────────────────┐
│  EcoDominicano      │ ◄─────────────────────────► │  Distributor VM          │
│  Web Server         │                             │                          │
│                     │   • RSS/Atom feed            │  • Fetch new articles    │
│  • CMS / WordPress  │   • REST API (if available)  │  • Parse content         │
│  • RSS feed         │   • Sitemap.xml              │  • Format for platforms  │
│  • Sitemap          │                             │  • Post & log            │
└─────────────────────┘                             └──────────────────────────┘
                                                              │
                                                              │ Platform APIs / Browser automation
                                                              ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │  Reddit │ Facebook Groups │ Telegram │ WhatsApp Web      │
                     └─────────────────────────────────────────────────────────┘
```

**Data flow:**
- **Pull-only**: VM pulls content from the website. No write access to the site.
- **Detection methods** (in order of preference):
  1. RSS/Atom feed (`/feed/` or `/rss/`)
  2. REST API endpoint (if the site exposes one)
  3. Sitemap.xml + HTML scraping
  4. Scheduled scrape of a "recent articles" page

### 1.3 Automation Workflow

```
[Daily Timer Trigger] → [Create Run Record] → [Fetch New Articles] → [Filter/Dedupe]
                                                              │
                                                              ▼
                     [Evaluate Platform Policy / Cooldown / Last Success]
                                                              │
                                     ┌────────────────────────┼────────────────────────┐
                                     ▼                        ▼                        ▼
                              [Skip Platform]         [Queue Platform Post]     [Pause Platform]
                                     │                        │                        │
                                     ▼                        ▼                        ▼
                              [Write Run Log]        [Post + Track Result]      [Alert + Log]
                                                              │
                                                              ▼
                                                   [Retry / Backoff / Final Status]
```

### 1.4 Security Boundaries

| Boundary | Implementation |
|----------|----------------|
| **VM isolation** | Distributor runs on separate VM; no shared network with web server except public internet |
| **Credentials** | All API keys, tokens, passwords stored in `/opt/ecodominicano-distributor/config/.env` (chmod 600) |
| **No inbound services** | VM does not expose HTTP/SSH to the internet unless explicitly configured; SSH only from host |
| **Least privilege** | Run distributor as dedicated user `ecodist`, not root |
| **Secrets** | Use environment variables; never commit secrets to repo |

### 1.4.1 VM Access From Host Machine

The distributor must be installed and operated **inside the Ubuntu VM**, not on the main Windows PC. That keeps browser automation, scheduled jobs, and Playwright dependencies off the host machine.

Use this command from the Windows host to connect to the VM:

```powershell
ssh -i $env:USERPROFILE\.ssh\ecodominicano_vm lmolina@192.168.12.108
```

Recommendation:
- Treat this as the standard operator entry point for deployment, debugging, and manual runs.
- Keep the SSH private key only on trusted operator machines.
- Do not run the distributor directly on the host PC unless the VM is unavailable.

### 1.5 Anti-Ban Control Model

This is the missing piece in the original version. Daily automation without memory is dumb and will get accounts flagged.

The distributor must persist operational history locally and make posting decisions from that history before touching any platform.

Core rules:
- Run the scheduler every day, but do **not** force a post every day on every platform.
- Before posting, check:
  - when the platform account last ran
  - when it last posted successfully
  - how many times it posted in the last 1, 7, and 30 days
  - whether the platform is in cooldown or temporary pause
  - whether the specific article was already posted there
- If the policy says the platform is not eligible today, mark it as `skipped_by_policy` and move on.
- Store the platform's safe cadence in config, not hardcoded in code.
- Prefer a missed post over a banned account.

---

## 2. Required Software

### 2.1 Ubuntu Packages

The VM runs **Ubuntu Desktop 24.04 LTS**. Most Chromium/browser display dependencies are pre-installed by the desktop environment and do not need to be added manually.

```bash
# System essentials
sudo apt update
sudo apt install -y curl wget git build-essential sqlite3

# Playwright may still need a few libs not included in the desktop base
# Run after Playwright install: npx playwright install-deps chromium
# Or install manually if needed:
# sudo apt install -y libnss3 libatk-bridge2.0-0 libdrm2 libgbm1

# Optional: for Python virtualenv
sudo apt install -y python3-venv python3-pip

# Optional: for Node.js (if using nvm, skip apt node)
# sudo apt install -y nodejs npm
```

### 2.2 Node.js (Recommended for Playwright)

Install nvm and Node.js **as the `ecodist` service user**, not as `lmolina`. The systemd service runs as `ecodist`, so nvm must be available in that user's shell environment.

```bash
# Switch to the ecodist user first
sudo -u ecodist -i

# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# Install and pin Node 20 LTS
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node -v && npm -v
```

### 2.3 Python (Alternative or Complementary)

Use Python if you prefer Selenium/Playwright Python bindings or for lightweight scripts:

```bash
python3 -m venv /opt/ecodominicano-distributor/venv
source /opt/ecodominicano-distributor/venv/bin/activate
pip install playwright feedparser requests
playwright install chromium
```

### 2.4 Browser Automation

| Tool | Use Case | Notes |
|------|----------|-------|
| **Playwright** | Reddit, Facebook Page/Groups, WhatsApp Channel session (browser-based) | Headed or headless Chromium; robust, good API |
| **Puppeteer** | Same as above | Node-only; slightly lighter |
| **Telegram Bot API** | Telegram channels | HTTP API — no browser needed |
| **Reddit API** | Reddit (if using API) | OAuth2; rate limits apply |
| **Facebook Graph API** | Facebook (limited for groups) | Groups often require browser automation |

**Recommendation:** Playwright (Node.js) for browser-based platforms; native APIs (Telegram, Reddit) where possible to avoid bans. Since the VM runs Ubuntu Desktop, Playwright can run headed (with a visible window) during login/setup and headless or minimized during normal scheduled runs.

WhatsApp Web automation is disabled by default and should not be treated as a first-class target. Prefer `WhatsApp Channel` workflows where possible.

### 2.5 Scheduling

| Tool | Use Case |
|------|----------|
| **cron** | Simple time-based triggers (e.g., every 2 hours) |
| **systemd timers** | More robust; better logging, dependency management |

**Recommendation:** Use a daily `systemd` timer for the main distributor. The timer should run once per day, and the application should decide which platforms are eligible that day.

### 2.6 Local Tracking Store

Use **SQLite** as the local state store instead of only JSON files.

Why:
- reliable persistence across reboots
- easy auditing of last runs and post history
- simple local queries over time windows
- safer than spreading state across multiple ad-hoc JSON files

Recommended schema:

| Table | Purpose |
|------|---------|
| `runs` | One row per scheduler/manual execution |
| `run_platforms` | Per-platform result for a run: attempted, skipped, success, failed |
| `articles` | Normalized article metadata discovered from the site |
| `deliveries` | Article-to-platform posting history |
| `platform_policies` | Safe cadence and limits per platform/account |
| `platform_cooldowns` | Current pause windows caused by rate limit or ban signals |

---

## 3. Automation Pipeline

### 3.1 Detecting New Articles

| Method | Implementation |
|--------|----------------|
| **RSS/Atom** | Poll `https://ecodominicano.com/feed/` (or equivalent); parse with `feedparser` (Python) or `rss-parser` (Node) |
| **API** | `GET /api/posts?since=<last_run>` if available |
| **Sitemap** | Parse `sitemap.xml`, filter by `lastmod`, fetch new URLs |
| **Scrape** | Playwright: visit recent-articles page, extract links; compare with stored article and delivery history in SQLite |

**State tracking:** Persist discovered articles and delivery history in SQLite. `processed.json` is fine for a prototype, but for real daily operations you want queryable history.

### 3.2 Triggering Distribution Tasks

| Trigger | When |
|---------|------|
| **systemd timer** | Once per day, with randomized delay |
| **Manual** | `npm run distribute` or `python -m distributor.run` |
| **Webhook** (optional) | If the site can send publish events; still pass through policy checks |

### 3.3 Distribution Decision Engine

The scheduler should create a `run` record first, then evaluate every platform against its policy.

Decision inputs:
- `last_run_at`
- `last_success_at`
- `last_failure_at`
- `success_count_last_7d`
- `success_count_last_30d`
- `consecutive_failures`
- `cooldown_until`
- `min_days_between_posts`
- `max_posts_per_day`
- `max_posts_per_7d`

Decision outcomes:
- `eligible`
- `skipped_no_new_content`
- `skipped_already_posted`
- `skipped_by_policy`
- `paused_platform`
- `attempted`

Sample policy logic:

```text
IF platform.cooldown_until > now => paused_platform
IF deliveries for article+platform already exist with success => skipped_already_posted
IF days_since(last_success_at) < min_days_between_posts => skipped_by_policy
IF success_count_last_7d >= max_posts_per_7d => skipped_by_policy
ELSE => eligible
```

This gives you the exact mechanism you asked for: the VM knows when it last ran, whether it posted successfully, where it posted, and whether enough days have passed to post there again.

### 3.4 Post Generation

Per-platform formatting:

| Platform | Format |
|----------|--------|
| **Reddit** | Title + link; optional short summary. Subreddit-specific rules (flair, etc.) |
| **Facebook Page** | Post text + link; image if available |
| **Facebook Groups** | Same as Page; apply stricter cadence and manual-approval rules per group |
| **Telegram** | Message + link; use `sendMessage` or `sendPhoto` |
| **WhatsApp Channel** | Short headline + link; preferred over WhatsApp Web for automation |
| **WhatsApp Web** | Disabled by default; browser automation only if explicitly enabled per-target |

Templates in `/opt/ecodominicano-distributor/config/templates/` (e.g., `reddit.txt`, `telegram.txt`).

### 3.5 Logging and Failure Handling

| Aspect | Implementation |
|--------|----------------|
| **Logs** | Structured logs to `/opt/ecodominicano-distributor/logs/` — daily rotation |
| **Run ledger** | Every execution writes `run_id`, start/end time, trigger type, and final status |
| **Success/failure** | Log each post attempt with platform, article ID, status, policy decision, error message |
| **Retries** | Retry failed posts up to 3 times with exponential backoff (e.g., 5m, 15m, 45m) |
| **Dead letter** | Failed posts after retries → `logs/failed-posts.json` for manual review |

---

## 4. Directory Structure for the VM

```
/opt/ecodominicano-distributor/
├── README.md
├── package.json              # or requirements.txt
├── .env.example
│
├── config/
│   ├── .env                  # Secrets (gitignored)
│   ├── settings.json         # Non-secret config (feeds, platform cadence, thresholds)
│   └── templates/
│       ├── reddit.txt
│       ├── facebook.txt
│       ├── telegram.txt
│       └── whatsapp.txt
│
├── scripts/
│   ├── fetch-articles.js     # or .py
│   ├── distribute.js         # Main orchestrator
│   ├── platforms/
│   │   ├── reddit.js
│   │   ├── facebook.js
│   │   ├── telegram.js
│   │   └── whatsapp.js
│   └── utils/
│       ├── logger.js
│       └── rate-limiter.js
│
├── data/
│   └── distributor.db        # SQLite state store
│
├── state/
│   ├── browser-sessions/     # Persistent Playwright sessions
│   ├── run.lock              # Prevent overlapping runs
│   └── exports/              # Optional JSON exports for debugging
│
├── logs/
│   ├── distributor.log       # Main log (rotated)
│   ├── distributor-2025-03-12.log
│   └── failed-posts.json     # Posts that failed after retries
│
└── venv/                     # Python venv (if using Python)
    # or node_modules/        # Node deps
```

---

## 5. Deployment Steps

### 5.1 Initial VM Setup

The VM runs **Ubuntu Desktop 24.04 LTS**. You can access it directly via the VM console or via SSH from the Windows host.

SSH from the Windows host (use the alias if configured, otherwise the full command):

```powershell
# Short alias (if configured in ~/.ssh/config)
ssh ubuntu-vm

# Full command
ssh -i $env:USERPROFILE\.ssh\ecodominicano_vm lmolina@192.168.12.108
```

All installation steps below must be run inside the Ubuntu VM, not on the host PC.

```bash
# 1. Create dedicated user
sudo useradd -r -m -s /bin/bash ecodist

# 2. Create directory structure
sudo mkdir -p /opt/ecodominicano-distributor/{config,config/templates,scripts,scripts/platforms,scripts/utils,data,state,state/browser-sessions,state/exports,logs}
sudo chown -R ecodist:ecodist /opt/ecodominicano-distributor
```

### 5.2 Install Dependencies

```bash
# As ecodist or with sudo -u ecodist
cd /opt/ecodominicano-distributor

# Node.js path
git clone https://github.com/molicoder-bit/EcoDominicano-Distribution.git .
# Or: copy files from host

npm install
# Or: pip install -r requirements.txt && playwright install chromium
```

### 5.3 Environment Variables

```bash
# Copy template
cp config/.env.example config/.env
chmod 600 config/.env

# Edit with actual values
nano config/.env
```

**Example `.env`:**
```env
# EcoDominicano source
FEED_URL=https://ecodominicano.com/feed/
SITE_URL=https://ecodominicano.com
STATE_DB_PATH=/opt/ecodominicano-distributor/data/distributor.db
TIMEZONE=America/Santo_Domingo

# Reddit (if using API)
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_REFRESH_TOKEN=
REDDIT_SUBREDDIT=

# Facebook (browser automation — store credentials in config, use carefully)
# FB_EMAIL=
# FB_PASSWORD=

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL_ID=

# WhatsApp — browser automation; no API token
# WA_SESSION_PATH=/opt/ecodominicano-distributor/state/wa-session
```

### 5.4 Configure Platform Policy

Create `config/settings.json` with non-secret anti-ban rules.

Example:

```json
{
  "scheduler": {
    "timezone": "America/Santo_Domingo"
  },
  "platforms": {
    "reddit": {
      "enabled": true,
      "minDaysBetweenPosts": 2,
      "maxPostsPerDay": 1,
      "maxPostsPer7Days": 3,
      "randomDelaySeconds": [60, 180]
    },
    "facebookGroups": {
      "enabled": true,
      "minDaysBetweenPosts": 3,
      "maxPostsPerDay": 1,
      "maxPostsPer7Days": 2,
      "randomDelaySeconds": [120, 300]
    },
    "telegram": {
      "enabled": true,
      "minDaysBetweenPosts": 1,
      "maxPostsPerDay": 1,
      "maxPostsPer7Days": 5,
      "randomDelaySeconds": [30, 90]
    },
    "whatsappWeb": {
      "enabled": false,
      "minDaysBetweenPosts": 4,
      "maxPostsPerDay": 1,
      "maxPostsPer7Days": 2,
      "randomDelaySeconds": [180, 420]
    }
  }
}
```

The important part is that `minDaysBetweenPosts` is persisted and enforced. The VM should never guess this at runtime.

### 5.5 Install and Enable systemd Service

```bash
# Copy service file to systemd
sudo cp /opt/ecodominicano-distributor/deploy/ecodominicano-distributor.service /etc/systemd/system/
sudo cp /opt/ecodominicano-distributor/deploy/ecodominicano-distributor.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable ecodominicano-distributor.timer
sudo systemctl start ecodominicano-distributor.timer
```

---

## 6. Operational Commands

| Action | Command |
|--------|---------|
| **Start distributor (timer)** | `sudo systemctl start ecodominicano-distributor.timer` |
| **Stop distributor** | `sudo systemctl stop ecodominicano-distributor.timer` |
| **Run manual distribution** | `cd /opt/ecodominicano-distributor && npm run distribute` |
| **SSH into VM from host** | `ssh -i $env:USERPROFILE\.ssh\ecodominicano_vm lmolina@192.168.12.108` |
| **View timer status** | `systemctl status ecodominicano-distributor.timer` |
| **View next run** | `systemctl list-timers ecodominicano-distributor.timer` |
| **Monitor logs (live)** | `tail -f /opt/ecodominicano-distributor/logs/distributor.log` |
| **View today's log** | `cat /opt/ecodominicano-distributor/logs/distributor-$(date +%Y-%m-%d).log` |
| **Restart service** | `sudo systemctl restart ecodominicano-distributor.timer` |
| **Run single platform** | `npm run distribute -- --platform=telegram` |
| **Inspect last runs** | `sqlite3 /opt/ecodominicano-distributor/data/distributor.db "select id,trigger_type,started_at,finished_at,status from runs order by started_at desc limit 10;"` |
| **Inspect platform history** | `sqlite3 /opt/ecodominicano-distributor/data/distributor.db "select platform,article_url,posted_at,status from deliveries order by posted_at desc limit 20;"` |
| **Inspect current cooldowns** | `sqlite3 /opt/ecodominicano-distributor/data/distributor.db "select platform,cooldown_until,reason from platform_cooldowns where cooldown_until > datetime('now');"` |

---

## 7. Failure Handling

### 7.1 Retry Logic

| Strategy | Implementation |
|----------|----------------|
| **Attempts** | Max 3 attempts per post |
| **Backoff** | Exponential: 5 min, 15 min, 45 min |
| **Permanent failure** | After 3 failures → append to `failed-posts.json` |
| **Transient errors** | Network timeouts, 5xx → retry |
| **Permanent errors** | 4xx auth, "banned" → no retry, log and skip |

### 7.2 Posting Cadence Tracking

Each platform/account must have persisted posting metadata, for example:

| Field | Meaning |
|------|---------|
| `last_run_at` | Last time the distributor evaluated this platform |
| `last_attempt_at` | Last time it tried to post |
| `last_success_at` | Last successful post |
| `last_success_article_url` | Last article posted successfully |
| `consecutive_failures` | Current failure streak |
| `cooldown_until` | Do not post before this timestamp |
| `safe_min_days_between_posts` | Minimum wait between successful posts |

This is the actual anti-ban backbone. Without this data, you are flying blind.

### 7.3 Rate Limiting

| Platform | Approach |
|----------|----------|
| **Reddit** | Conservative policy: 1 post every 2-3 days per subreddit/account |
| **Facebook** | Conservative policy: 1 post every 3-4 days per group/account |
| **Telegram** | Safer channel for automation: 1 post per day is generally acceptable |
| **WhatsApp** | Highest ban risk: 1 post every 4-7 days, or disable until really needed |

**Implementation:** Use both short-term rate limiting and long-term cadence rules. Short-term rate limiting prevents bursts; cadence rules prevent repetitive daily posting patterns that get accounts flagged.

These values should be configurable in `config/settings.json`, not hardcoded. Start stricter than you think you need, then loosen only after you have clean history.

### 7.4 Avoiding Platform Bans

| Measure | Description |
|---------|-------------|
| **Randomization** | Add per-platform random delay before posting and randomize the daily execution window |
| **Human-like behavior** | Vary post days and times; daily run does not mean daily post |
| **Content variation** | Slightly vary titles/format per platform |
| **Account health** | Use aged accounts; avoid new accounts for automation |
| **Monitoring** | Log 429/403 responses, captchas, checkpoint pages, login challenges, and suspicious browser prompts |
| **Circuit breaker** | If platform returns "banned", repeated 403, captcha, or challenge page, pause that platform for 3-7 days and require manual review |
| **Platform rotation** | On any given day, post only to eligible platforms instead of all enabled platforms |
| **Account rotation** | If allowed, support multiple accounts/groups/channels and rotate them conservatively |

### 7.5 Recommended Safe Starting Policy

These are not guarantees. They are conservative defaults to reduce risk:

| Platform | Safe Min Days Between Successful Posts | Notes |
|---------|-----------------------------------------|-------|
| **Reddit** | `2` | More frequent than this is asking for trouble unless the account is very established |
| **Facebook Groups** | `3` | Groups are sensitive to repetitive links and automation patterns |
| **Telegram** | `1` | Lowest friction platform here, but still track failures and spam complaints |
| **WhatsApp Web** | `4` to `7` | Highest risk. Keep disabled initially unless there's a real reason to use it |

If the account is new, increase these numbers. New accounts plus automation is a bad combo.

### 7.6 Run Outcome Rules

At the end of every run, write:
- overall run status
- per-platform status
- article selected
- whether the platform was skipped or posted
- exact reason for skip/failure

Per-platform statuses should be one of:
- `success`
- `failed_retryable`
- `failed_permanent`
- `skipped_by_policy`
- `skipped_no_content`
- `skipped_already_posted`
- `paused_platform`

That gives you a clean answer to: when did it last run, where did it post, and why did it skip the rest.

---

## 8. Distribution Expansion Strategy

The distributor should not be limited to raw social reposting. Long-term growth needs a mix of owned channels, lower-risk external channels, and selective high-risk community posting.

### 8.1 Channel Tiers

Use three channel tiers:

| Tier | Purpose | Examples |
|------|---------|----------|
| **Owned channels** | Stable reach with minimal platform risk | Email newsletter, web push, Telegram channel, WhatsApp Channel, RSS |
| **External distribution** | Publisher-friendly or lower-risk discovery channels | Facebook Page, Google News, Google Discover optimization, Apple News, Flipboard, Pinterest, LinkedIn |
| **High-risk community channels** | Opportunistic traffic, but highest moderation or ban risk | Facebook Groups, Reddit, WhatsApp Web groups, X, Threads, Discord communities |

### 8.2 Additional Distribution Channels To Include

| Channel | Why It Matters | Recommended Automation Level |
|---------|----------------|------------------------------|
| **Email newsletter** | Highest-value owned audience; not dependent on feed algorithms | High; send daily or weekly digest |
| **Web push notifications** | Strong for breaking news and return visits | High; event-driven or scheduled |
| **WhatsApp Channel** | Better than automating personal/group WhatsApp activity | Medium to high; use official channel workflows if available |
| **Facebook Page** | Controlled base layer before posting into groups | High |
| **Google News / Publisher Center** | Better long-term reach than spammy social posting | Medium; operational setup, not constant posting automation |
| **Google Discover optimization** | Major discovery surface for news content | Medium; focus on SEO, freshness, images, speed |
| **Apple News** | Additional publisher distribution channel if eligible | Medium |
| **Flipboard** | Easy syndication path for article content | Medium |
| **Pinterest** | Useful for evergreen, curiosity, or viral content with strong visuals | Medium |
| **LinkedIn Page** | Good for economy, politics, tourism, and diaspora/business-related posts | Low to medium |
| **X / Twitter** | Fast news surface, but automation risk and policy friction | Low; only if there is a clean workflow |
| **Threads** | Potential reach, but weak automation story | Low |
| **Instagram** | Good for visual summaries, not raw link dumping | Medium if image cards are produced |
| **TikTok / YouTube Shorts** | Strong upside for short news recaps and `La Chercha` clips | Medium later; requires media generation workflow |
| **Discord communities** | Niche community traffic, especially diaspora/topic groups | Low; mostly manual or semi-manual |

### 8.3 Content-to-Channel Mapping

Do not distribute every article to every platform. Match the content type to the channel.

| Content Type | Best Channels | Notes |
|-------------|---------------|-------|
| **Breaking news** | Telegram, Facebook Page, web push, WhatsApp Channel | Prioritize speed and clarity |
| **Short news posts** | Telegram, Facebook Page, Google News, Flipboard | Keep formatting simple |
| **`La Chercha` / humorous commentary** | Facebook Page, Instagram, TikTok, YouTube Shorts, Telegram | Best suited for visual or short-form formats |
| **Viral/light content** | Facebook Groups, Pinterest, Telegram, WhatsApp Channel | Use image cards where possible |
| **Politics/economy/tourism/business** | LinkedIn, Facebook Page, Google News, selective Reddit | Better fit for more serious audiences |
| **Evergreen content** | Pinterest, newsletter digest, Facebook Page | Do not treat evergreen like breaking news |

### 8.4 Community Targets To Research

In addition to platforms, the project should maintain a curated target list of communities:

- Dominican diaspora Facebook groups
- Dominican Republic and Caribbean subreddits
- Telegram communities relevant to DR news, humor, sports, and entertainment
- WhatsApp communities and channels
- Discord communities focused on DR, Caribbean topics, baseball, tourism, memes, and politics
- City/topic Facebook groups for Santo Domingo, Santiago, entertainment, tourism, baseball, local politics, and expat audiences

These communities should be stored in configuration with metadata such as:
- platform
- community name
- posting rules
- link allowed or not
- cooldown days
- manual approval required
- account to use

### 8.5 Recommended Priority Order

Roll this out in phases instead of trying to automate everything at once.

| Priority | Channel | Reason |
|---------|---------|--------|
| **1** | Telegram channel | Cleanest automation target |
| **2** | Facebook Page | Controlled distribution surface |
| **3** | Email newsletter | Best owned audience asset |
| **4** | Web push notifications | Strong return traffic |
| **5** | Google News / Discover readiness | Better long-term traffic source |
| **6** | Selective Facebook Groups | Useful but moderation-sensitive |
| **7** | Reddit | Good selectively, bad as a dump channel |
| **8** | WhatsApp Channel | Safer than aggressive WhatsApp Web usage |
| **9** | Pinterest | Good for evergreen/viral content with visuals |
| **10** | Short-form video channels | High upside, but more production work |

### 8.6 Channels To Avoid As Core Automation

These can exist, but they should not be the backbone of the strategy:

- WhatsApp Web group blasting
- Heavy X browser automation
- Threads automation as a primary distribution method
- Identical daily link posting to the same communities
- Treating all platforms as equally valuable

### 8.7 Technical Implications Of Expanded Distribution

Supporting these extra channels changes the system design:

| Capability | Why It Is Needed |
|-----------|------------------|
| **Digest builder** | Required for email newsletters and daily/weekly summaries |
| **Push notification module** | Needed for web push providers such as OneSignal or Firebase |
| **Image card generator** | Needed for Instagram, Pinterest, and better Facebook performance |
| **Short-video generation pipeline** | Needed for TikTok and YouTube Shorts later |
| **Community registry** | Needed to track group/channel/server-specific posting rules |
| **Per-channel content templates** | Needed because each platform needs different copy and formatting |
| **Manual review queue** | Needed for high-risk or moderator-sensitive communities |

### 8.8 Rollout Recommendation

Phase the rollout like this:

1. Launch owned channels first: Telegram, email, and web push.
2. Add controlled external channels: Facebook Page, Google News readiness, and Flipboard.
3. Add selective community channels with strict policy checks: Facebook Groups and Reddit.
4. Add experimental channels only after stable operations: WhatsApp Channel, Pinterest, LinkedIn, Instagram.
5. Add media-heavy channels later if the content pipeline supports them: TikTok and YouTube Shorts.

---

## 9. Implementation Checklist

- [ ] Provision Ubuntu VM
- [ ] Create `ecodist` user and directory structure
- [ ] Install Node.js (or Python) and Playwright
- [ ] Clone repo and install deps
- [ ] Configure `.env` with credentials
- [ ] Build or integrate email newsletter delivery
- [ ] Build or integrate web push notifications
- [ ] Implement `fetch-articles` (RSS/API/scrape)
- [ ] Implement platform modules (Telegram, Facebook Page, Facebook Groups, Reddit, WhatsApp Channel/Web, optional LinkedIn/Pinterest)
- [ ] Implement main `distribute` orchestrator
- [ ] Add SQLite state store and migration script
- [ ] Add per-platform policy engine
- [ ] Add retry logic, cooldowns, and cadence limits
- [ ] Add community registry with per-group/per-channel rules
- [ ] Add content-to-channel routing rules
- [ ] Add manual review flow for high-risk communities
- [ ] Evaluate Google News / Discover / Apple News readiness
- [ ] Evaluate image-card generation for Pinterest and Instagram
- [ ] Evaluate short-video pipeline for TikTok and YouTube Shorts
- [ ] Add logging and failed-posts handling
- [ ] Create systemd service and timer
- [ ] Test manual run
- [ ] Enable timer and verify scheduled runs
- [ ] Set up log rotation (logrotate)
- [ ] Document SSH access and backup procedures

---

## Appendix A: Example systemd Files

**`ecodominicano-distributor.service`**
```ini
[Unit]
Description=EcoDominicano Content Distributor
After=network.target

[Service]
Type=oneshot
User=ecodist
WorkingDirectory=/opt/ecodominicano-distributor
EnvironmentFile=/opt/ecodominicano-distributor/config/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run distribute -- --mode=scheduled
StandardOutput=append:/opt/ecodominicano-distributor/logs/distributor.log
StandardError=append:/opt/ecodominicano-distributor/logs/distributor.log

[Install]
WantedBy=multi-user.target
```

**`ecodominicano-distributor.timer`**
```ini
[Unit]
Description=Run EcoDominicano distributor once per day

[Timer]
OnCalendar=daily
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
```

---

## Appendix B: Suggested Tech Stack Summary

| Layer | Choice |
|-------|--------|
| **Runtime** | Node.js 20 LTS |
| **Browser automation** | Playwright (Chromium) |
| **Feed parsing** | `rss-parser` or `feedparser` (Python) |
| **Scheduling** | systemd timers |
| **Logging** | Winston (Node) or structlog (Python) + daily file rotation |

---

*Document version: 1.1 — March 2026*
