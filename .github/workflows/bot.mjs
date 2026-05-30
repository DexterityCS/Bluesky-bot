// bot.mjs — CS2 Bluesky Bot
// Runs inside GitHub Actions on a schedule
// @dexteritycs.bsky.social

import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";

const {
  ANTHROPIC_API_KEY,
  BLUESKY_HANDLE,
  BLUESKY_APP_PASSWORD,
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  FORCE_TYPE,
} = process.env;

const TWITCH_USERNAME = "dexterity_cs";

// ── Validate ──────────────────────────────────────────────────
const missing = ["ANTHROPIC_API_KEY","BLUESKY_HANDLE","BLUESKY_APP_PASSWORD","TWITCH_CLIENT_ID","TWITCH_CLIENT_SECRET"]
  .filter(k => !process.env[k]);
if (missing.length) {
  console.error("❌ Missing secrets:", missing.join(", "));
  process.exit(1);
}

// ── Post type rotation ────────────────────────────────────────
const ROTATION = [
  { type: "hot_take",  weight: 3 },
  { type: "challenge", weight: 3 },
  { type: "poll",      weight: 2 },
  { type: "tip",       weight: 1 },
];

function weightedPick() {
  const pool = ROTATION.flatMap(t => Array(t.weight).fill(t.type));
  return pool[Math.floor(Math.random() * pool.length)];
}

const SYSTEM_PROMPT = `You are Dexterity, a Premier-ranked CS2 streamer on Twitch (twitch.tv/dexterity_cs) and Bluesky (@dexteritycs.bsky.social).
Your posts are: punchy, opinionated, knowledgeable, a bit edgy, never corporate.
600+ matches played, peaked 13,475 Premier rating. You know the game deeply.
Write exactly like a real CS2 player/streamer — not a brand account.
Output ONLY the post text. No quotes. No explanation. No preamble.`;

// ── Twitch live check ─────────────────────────────────────────
async function isLive() {
  try {
    const tokenRes = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
      { method: "POST" }
    );
    const { access_token } = await tokenRes.json();

    const streamRes = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${TWITCH_USERNAME}`,
      { headers: { "Client-ID": TWITCH_CLIENT_ID, "Authorization": `Bearer ${access_token}` } }
    );
    const data = await streamRes.json();
    const live = data.data?.length > 0;
    console.log(live ? "🟢 Stream is LIVE" : "⚫ Stream is offline");
    return live;
  } catch(e) {
    console.log(`⚠️  Twitch check failed: ${e.message}`);
    return false;
  }
}

// ── CS2 update check ──────────────────────────────────────────
async function getLatestCS2Update() {
  try {
    const url  = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&count=5&maxlength=400&format=json";
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const items = data?.appnews?.newsitems || [];

    const updates = items.filter(i =>
      i.feedname === "steam_community_announcements" ||
      i.title?.toLowerCase().includes("update") ||
      i.title?.toLowerCase().includes("release notes")
    );

    return updates[0] || null;
  } catch {
    return null;
  }
}

// GitHub Actions doesn't persist files between runs so we use
// a workaround: store the last seen update ID in a repo variable
// via the GitHub API, or simply check if the update is < 6 hours old
function isRecentUpdate(update) {
  if (!update) return false;
  const updateTime = new Date(update.date * 1000);
  const hoursAgo   = (Date.now() - updateTime) / (1000 * 60 * 60);
  return hoursAgo < 6; // Only post if update dropped in last 6 hours
}

// ── Generate post ─────────────────────────────────────────────
async function generatePost(type, context = "") {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const prompts = {
    hot_take:  `Write a spicy CS2 hot take or unpopular opinion. Be bold — something that makes people want to agree or disagree loudly. End with a question to spark replies. 2-3 hashtags. Max 240 chars.`,
    challenge: `Write a community engagement post for CS2 players. Make it a reply-bait question or challenge. Examples: "Drop your highest damage round and I'll rate your lobby", "Reply with your rank and your most-played map", "What map gets you instantly tilted?", "Name a CS2 experience only real ones understand". People should want to reply. 2-3 hashtags. Max 240 chars.`,
    poll:      `Write an engagement question for CS2 players — frame it as "which would you rather" or "pick one" or "agree or disagree". Tell people to reply with their answer. Make it controversial enough to spark debate. Do NOT use bullet points or option lists — just ask the question and tell them to reply. 2-3 hashtags. Max 240 chars.`,
    tip:       `Write a specific CS2 gameplay tip. Name the exact map, position, or mechanic. Make it something most players don't know. 2-3 hashtags. Max 240 chars.`,
    update:    `Write a reaction post to a new CS2 update. Update title: "${context}". Give your honest hot take — good change? bad? what does it mean for the meta? Be opinionated. 2-3 hashtags. Max 240 chars.`,
    promo:     `Write a stream promo post for twitch.tv/dexterity_cs. I'm live RIGHT NOW playing CS2. Make it urgent and specific — mention the grind, a challenge, or something happening on stream. Give people FOMO. Don't be generic. 2 hashtags max. Max 240 chars.`,
  };

  const msg = await anthropic.messages.create({
    model:      "claude-opus-4-5",
    max_tokens: 300,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: prompts[type] }],
  });

  return msg.content[0].text.trim();
}

// ── Post to Bluesky ───────────────────────────────────────────
async function postToBluesky(text) {
  // Login
  const loginRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ identifier: BLUESKY_HANDLE, password: BLUESKY_APP_PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${await loginRes.text()}`);
  const { accessJwt, did } = await loginRes.json();

  // Build facets
  const facets  = [];
  const encoder = new TextEncoder();
  let match;

  const urlRegex = /https?:\/\/[^\s]+/g;
  while ((match = urlRegex.exec(text)) !== null) {
    const start = encoder.encode(text.slice(0, match.index)).length;
    const end   = start + encoder.encode(match[0]).length;
    facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }] });
  }

  const tagRegex = /#(\w+)/g;
  while ((match = tagRegex.exec(text)) !== null) {
    const start = encoder.encode(text.slice(0, match.index)).length;
    const end   = start + encoder.encode(match[0]).length;
    facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: match[1] }] });
  }

  // Post
  const postRes = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessJwt}` },
    body:    JSON.stringify({
      repo: did, collection: "app.bsky.feed.post",
      record: { $type: "app.bsky.feed.post", text, facets: facets.length ? facets : undefined, createdAt: new Date().toISOString() },
    }),
  });

  if (!postRes.ok) throw new Error(`Post failed: ${await postRes.text()}`);
  return await postRes.json();
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  try {
    let type    = FORCE_TYPE || null;
    let context = "";

    // Check for new CS2 update first — takes priority
    if (!type) {
      const update = await getLatestCS2Update();
      if (isRecentUpdate(update)) {
        console.log(`📰 Recent CS2 update: ${update.title}`);
        type    = "update";
        context = update.title;
      }
    }

    // Check if live — post promo if so (15% chance to check on any cycle)
    if (!type) {
      const checkPromo = Math.random() < 0.15;
      if (checkPromo) {
        const live = await isLive();
        if (live) type = "promo";
      }
    }

    // Fall back to weighted random
    if (!type) type = weightedPick();

    console.log(`🤖 Posting type: [${type}]`);
    const post = await generatePost(type, context);
    console.log(`📝 "${post}"`);

    const result = await postToBluesky(post);
    console.log(`✅ Posted! URI: ${result.uri}`);

  } catch(err) {
    console.error("❌", err.message);
    process.exit(1);
  }
})();
