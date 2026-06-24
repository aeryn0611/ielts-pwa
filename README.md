# IELTS Synonyms — PWA Spaced Repetition App

A fully offline Progressive Web App for IELTS vocabulary study. Installable on iPhone, iPad, and macOS. No app store required.

---

## Running Locally

```bash
cd /Users/aeryn/ielts-pwa
python3 -m http.server 8080
```

Then open **http://localhost:8080** in your browser.

> **Note:** The app must be served over HTTP (not opened as a file://), because service workers require a server context.

---

## Deploying to GitHub Pages

1. **Create a new GitHub repository** at github.com — click "New repository", name it (e.g. `ielts-pwa`), set it to Public.

2. **Initialize git and push the files:**
   ```bash
   cd /Users/aeryn/ielts-pwa
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/ielts-pwa.git
   git push -u origin main
   ```

3. **Enable GitHub Pages:** Go to your repository → Settings → Pages → Source: select "Deploy from a branch" → Branch: `main` / `/ (root)` → Save.

4. **Wait ~2 minutes**, then your app will be live at:
   `https://YOUR_USERNAME.github.io/ielts-pwa/`

---

## Installing as a PWA on iPhone

1. Open Safari and navigate to your app URL (GitHub Pages link, or http://localhost:8080 on your local network).
2. Tap the **Share** button (the box with an arrow pointing up) at the bottom of Safari.
3. Scroll down and tap **"Add to Home Screen"**.
4. Tap **"Add"** in the top right.
5. The app icon ("SR") now appears on your home screen. Tap it to launch the app fullscreen, offline-capable.

---

## Installing as a PWA on iPad

Same steps as iPhone:
1. Open Safari → navigate to the app URL.
2. Tap the **Share** button (top right of Safari on iPad).
3. Tap **"Add to Home Screen"** → **"Add"**.
4. The app appears on your iPad home screen.

---

## Installing as a PWA on macOS

**Using Chrome:**
1. Open Chrome and navigate to the app URL.
2. Look for the **install icon** (a computer with a down-arrow) in the address bar on the right side. Click it.
3. Click **"Install"** in the dialog.
4. The app opens in its own window and is added to your Applications folder / Launchpad.

**Using Safari (macOS Sonoma 14+ required):**
1. Open Safari and navigate to the app URL.
2. Click **File** menu → **"Add to Dock"**.
3. The app appears in your Dock.

---

## App Features

| Screen | What it does |
|--------|-------------|
| **查词** | Search 640 IELTS words by prefix or fuzzy match. Tap a word to see its Chinese meaning, source, and all synonyms. Auto-plays TTS pronunciation sequence. |
| **复习** | Spaced repetition review. Shows words due today. Tap "显示答案" to reveal synonyms + hear TTS. Mark as remembered or retry. |
| **统计** | Overview of your review queue: total words, due today/this week, session count, mastery bar chart. |

## Spaced Repetition Schedule

Intervals: **1 → 2 → 4 → 7 → 15 → 30 days**

- **记住了 ✓** — advances to the next interval
- **再来一次 ↩** — resets to 1 day (due tomorrow)
- A word is **"mature"** once it reaches the ≥15 day interval

## Data

640 IELTS vocabulary entries from Liu's synonym list. Fully embedded in `data.js` — no network requests needed after first load.
