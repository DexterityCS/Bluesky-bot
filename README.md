# DEX BOT — CS2 Bluesky Engine

Automated Bluesky bot for [@dexteritycs.bsky.social](https://bsky.app/profile/dexteritycs.bsky.social) — posts CS2 content on a schedule, reacts to new game updates, and promotes streams when live. Runs entirely on GitHub Actions for free.

---

## What it posts

| Type | Frequency | Description |
|---|---|---|
| Hot take | 33% | Spicy CS2 opinions that spark debate and replies |
| Challenge | 33% | Reply-bait posts — "drop your rank", "name your worst map" |
| Poll | 22% | Engagement questions telling followers to reply with their answer |
| Tip | 11% | Specific map/mechanic tips most players don't know |
| Update | Situational | Reacts to new CS2 patch notes via Steam API — only fires when Valve drops something new |
| Promo | Situational | Stream promo — only fires when live on Twitch |

---

## Schedule (CST)

| Days | Times |
|---|---|
| Mon–Fri | 12:00 PM, 5:00 PM, 8:00 PM |
| Sat–Sun | 10:00 AM, 3:00 PM, 6:00 PM, 9:00 PM |

All times are CST. GitHub Actions runs on UTC — the cron jobs are offset accordingly.

---

## Dashboard

Live at **[dexteritycs.github.io/Bluesky-bot](https://dexteritycs.github.io/Bluesky-bot)**

- Recent posts pulled from Bluesky with engagement stats
- Countdown to next scheduled posts
- Workflow run history
- Manual trigger button — fire the bot immediately, optionally forcing a specific post type

---

## How it works

```
GitHub Actions cron job fires
        ↓
bot.mjs runs on ubuntu-latest
        ↓
Checks Steam API for new CS2 updates (posts if new)
Checks Twitch API if stream is live (posts promo if live)
Otherwise picks from weighted rotation
        ↓
Claude generates the post in Dexterity's voice
        ↓
Posts to Bluesky via AT Protocol API
```

---

## Files

```
Bluesky-bot/
├── .github/
│   └── workflows/
│       ├── cs2-bot.yml       ← Schedule + trigger config
│       ├── bot.mjs           ← Bot logic
│       └── keep-alive.yml    ← Monthly commit to keep repo active
├── data/
│   └── bot-stats.json        ← Auto-updated monthly by keep-alive
└── index.html                ← Dashboard (GitHub Pages)
```

---

## Secrets required

Set these in **Settings → Secrets → Actions**:

| Secret | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude AI — generates post content |
| `BLUESKY_HANDLE` | `dexteritycs.bsky.social` |
| `BLUESKY_APP_PASSWORD` | Generated at bsky.app → Settings → App Passwords |
| `TWITCH_CLIENT_ID` | From dev.twitch.tv — used to check if stream is live |
| `TWITCH_CLIENT_SECRET` | From dev.twitch.tv |

---

## Manual trigger

Go to **Actions → CS2 Bluesky Bot → Run workflow** to fire immediately. Optionally select a post type to force — leave blank for auto.

Or use the dashboard trigger button at the link above.

---

## Keep-alive

The `keep-alive.yml` workflow runs on the 1st of every month and commits an updated `data/bot-stats.json`. This keeps the repo active and prevents GitHub from pausing scheduled workflows after 60 days of inactivity.
