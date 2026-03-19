# Facebook & Instagram — compliance notes for future automation (EcoDominicano)

**Purpose:** Capture rules and risks *before* we implement FB/IG distribution in this repo.  
**Last updated:** 2026-03-19 (repo) — **re-check official Meta docs before any launch**; policies change.

---

## 1. Internal notes (from Gemini, March 2026 — treat as *draft*, not legal advice)

> Preserved verbatim-ish for product design. **Not verified** line-by-line against Meta’s legal text.

- **Transparency / “AI Info”**  
  - Meta uses an **“AI Info”** style label for content that is substantially AI-generated or altered (not only “fake” photos).  
  - Photorealistic imagery → stronger expectation to label. Text-on-graphics may be looser but disclosure still helps trust.  
  - **“Human oversight” idea:** If a human reviews/edits AI copy before publish, some frameworks treat it as *AI-assisted* vs *fully automated* — **confirm in Meta’s *current* disclosure UI and policies**, not third-party blogs.

- **Originality / “aggregator” risk**  
  - Claim: Meta penalizes pages that mostly repost others’ news without transformation.  
  - Mitigation ideas: Dominicanized tone + real editorial value; **vary visuals** (colors/fonts/layout) so posts don’t look identical.

- **Links (Facebook)**  
  - Claim: **Non-verified Pages** may face tight limits on **external links in the main post** (e.g. ~2/month in tests); **link in first comment** as workaround; engagement narrative.  
  - **Must re-verify** at implementation time — this has been **reported as a test**, not necessarily global or permanent.

- **Political / social issues**  
  - Stricter **AI disclosure** for election/social-issue content; risk to ads / reach if ignored.

- **Checklist snapshot (Gemini)**

| Feature        | Facebook              | Instagram        |
|----------------|----------------------|------------------|
| Primary label  | AI Info (near Page)  | AI Info / tags   |
| Links          | Risky in post body   | Bio / Stories?   |
| Reach drivers  | Shares to groups     | Reels / Explore  |

- **Suggested caption disclosure (Spanish)**  
  `Noticia resumida por EcoDominicano AI y verificada por humanos.`  
  (Adjust to match **actual** workflow: if fully automated, don’t claim “verified by humans”.)

- **Future idea:** “Jitter & variance” module (layout/caption structure) to avoid looking like a single template bot.

---

## 2. What we could verify from public sources (March 2026 web check)

Use these as **starting points**; always read the **current** policy pages.

### AI labeling & disclosures (organic + general)

- Meta documents **AI-generated content identification and labeling** (e.g. **“AI Info”**, detection, voluntary disclosure, C2PA-style signals).  
  - Help: [How AI-generated content is identified and labeled](https://www.meta.com/help/artificial-intelligence/how-ai-generated-content-is-identified-and-labeled-on-meta/)  
  - News (2024): [Labeling AI-generated images on Facebook, Instagram and Threads](https://about.fb.com/news/2024/02/labeling-ai-generated-images-on-facebook-instagram-and-threads)  
  - Policies: [AI disclosures (Transparency Center)](https://transparency.meta.com/policies/other-policies/meta-ai-disclosures/)  
  - Tracking: [Labeling AI Content | Transparency Center](https://transparency.meta.com/en-us/governance/tracking-impact/labeling-ai-content)

**Gap vs Gemini:** Official pages emphasize **labeling/detection** and **ads** in places; the exact line for **“human edited = no label on text”** for **organic Page posts** was **not** confirmed in this quick check — **do not rely on the “loophole” until Meta documents it or counsel agrees.**

### Political / social issues — **advertising**

- Meta requires **advertisers** to disclose AI / digital alteration for **ads about social issues, elections, or politics** (effective timing and UI evolved; labels described as **“AI Info”** in Meta comms).  
  - Blog: [Helping People Understand When AI is Used In Political or Social Issue Ads](https://www.facebook.com/government-nonprofits/blog/political-ads-ai-disclosure-policy)  
  - Standards: [Ads about Social Issues, Elections or Politics](https://transparency.meta.com/policies/ad-standards/SIEP-advertising/SIEP)  
  - Press: Reuters/AP coverage from 2023–2024 on political ad AI disclosures.

**Gap:** These are **ad** policies. **Organic** news posts about politics may still fall under **Community Standards**, **misinformation**, or **spam** rules — separate review needed.

### Link limits (Facebook Pages / “pro” accounts)

- Meta announced work against **spammy** behavior on Facebook (2025).  
  - [Cracking Down on Spammy Content on Facebook](https://about.fb.com/news/2025/04/cracking-down-spammy-content-on-facebook/)

- **Industry blogs** describe a **test** limiting **organic link posts** for some **Pages / professional mode** (numbers like **2/month** appear in **third-party** articles). Treat as **unconfirmed for your specific Page** until you see it in **Meta Business Help** or your **Page’s** in-product notices.

**Action before implementation:** In Creator Studio / Meta Business Suite, check **current** link-post behavior and any **subscription (e.g. Meta Verified)** requirements.

### “Aggregator” / originality / “Andromeda”

- **No primary Meta doc** was found in this pass that defines an **“aggregator account”** penalty with the specificity Gemini gave (e.g. a fixed March 2026 date).  
- **Spam** and **coordinated inauthentic behavior** are documented enforcement areas; **duplicate/low-effort** distribution can still hurt reach **without** a named “aggregator” rule.

**Action:** Design for **original commentary + clear sourcing + varied formats** anyway — good for compliance *and* product.

---

## 3. Pre-implementation checklist (engineering + editorial)

- [ ] Read **current** Meta **Community Standards**, **Page terms**, and **monetization** rules (if applicable).  
- [ ] Confirm **AI disclosure** flow for **Page posts** and **Reels** in the **actual** composer (toggles, required fields).  
- [ ] If using **ads** (boosted posts): complete **SIEP** / **AI disclosure** requirements.  
- [ ] **Link strategy:** validate whether your Page is in a **link-limit** test; prefer **native text/image + comment link** if needed.  
- [ ] **Truth in labeling:** Only claim “verificado por humanos” if **someone actually reviews** before publish.  
- [ ] **Logging:** Store `human_approved: true/false`, `disclosure_text`, `post_surface` (FB feed, IG Reels, etc.) for audit trail.  
- [ ] **Re-verify** all of the above **on go-live date** — this file is **not** a substitute for Meta’s official text.

---

## 4. Official / primary links (bookmark)

| Topic | URL |
|-------|-----|
| AI disclosures policy | https://transparency.meta.com/policies/other-policies/meta-ai-disclosures/ |
| Help: AI content labeled | https://www.meta.com/help/artificial-intelligence/how-ai-generated-content-is-identified-and-labeled-on-meta/ |
| Transparency Center (policies hub) | https://transparency.meta.com/ |
| SIEP ads | https://transparency.meta.com/policies/ad-standards/SIEP-advertising/SIEP |
| Meta newsroom / safety | https://about.fb.com/news/ |

---

## 5. Cursor / future agents

When implementing `facebookPage` / `instagram` in this repo:

1. Open this file and **update §2** with fresh links and quotes from Meta.  
2. Do **not** treat Gemini’s §1 as authoritative.  
3. Prefer **in-app disclosure toggles** + **accurate** Spanish copy over guessing.  
4. Add a **“compliance mode”** env flag if we need stricter defaults (e.g. always disclose AI assist).

---

*This document is for internal product planning only and is not legal advice.*
