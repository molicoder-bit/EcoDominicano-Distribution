# Reddit API setup (EcoDominicano Distributor)

The distributor posts **one link post per run** to a subreddit you configure, using OAuth2 with a **refresh token** (no browser automation).

## 1. Create a Reddit app

1. Log in as the account that will post (must be allowed to submit in the target sub).
2. Open **https://www.reddit.com/prefs/apps** (old Reddit prefs) or **Reddit → User menu → Settings** and find **Developer** / **Create App** (wording varies).
3. Create an app:
   - **Type:** `script` (or `web app` if you use redirect-based auth to obtain the refresh token).
   - **Redirect URI:** for script type often `http://localhost:8080` (must match what you use in the OAuth flow).
4. Note **client ID** (under the app name) and **secret**.

## 2. Get a refresh token

Reddit’s OAuth2 password grant for scripts is restricted; use **authorization code** flow once, then store the **refresh token**.

**Repo helper:** with `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, and `REDDIT_REDIRECT_URI` set in `config/.env`:

```bash
npm run reddit:token
```

Open the printed URL (while logged in as the posting account), approve, then paste the **full redirect URL** from the address bar (or paste only the `code` value). The script prints `REDDIT_REFRESH_TOKEN=...` to add to `.env`.

The Reddit app’s **redirect URI** must match `REDDIT_REDIRECT_URI` exactly (see `config/.env.example`, default `http://localhost:8080`). If the browser shows “connection refused” after redirect, that is normal for localhost — copy the URL from the bar anyway.

Scopes used by the helper: **`submit`**, `read`, `identity`.

Put in `config/.env` (after token step):

- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_REFRESH_TOKEN`
- `REDDIT_REDIRECT_URI` (must match the app)
- `REDDIT_USERNAME` — your Reddit username (default **User-Agent** includes `/u/username`).

Optional:

- `REDDIT_USER_AGENT` — full string if you don’t want the default  
  `web:EcoDominicano-Distributor:v1.0 (by /u/REDDIT_USERNAME)`.

## 3. Subreddits and limits

| Variable | Purpose |
|----------|---------|
| `REDDIT_SUBREDDIT` | Live subreddit name **without** `r/` (e.g. `EcoDominicano`). |
| `REDDIT_SUBREDDIT_TEST` | Sub you moderate for `--test` runs only. |
| `REDDIT_DAILY_LIMIT` / `REDDIT_DAILY_YELLOW` | Cap successful posts per local day (see `TIMEZONE`). |

## 4. Enable in settings

In `config/settings.json`, ensure the platform is enabled:

```json
"platforms": {
  "reddit": { "enabled": true }
}
```

## 5. Run

- Test: `npm run reddit:test` (same as `node scripts/distribute.js --test --platform=reddit`)
- Live: `npm run reddit:live`

Test posts are logged in `run_platforms` but **not** written to `deliveries`, so they do not affect the GUI daily counter or duplicate-URL checks for live.

## References

- [Reddit OAuth2 wiki](https://github.com/reddit-archive/reddit/wiki/OAuth2)
- [API rules](https://github.com/reddit-archive/reddit/wiki/API) — respect rate limits and **User-Agent** requirements.
