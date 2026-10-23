# Spotify Playlist Adder — Stream Deck Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/badge/Release-v1.0.0-1DB954.svg)](https://github.com/Yannis-A-D/spotify-streamdeck-playlist-adder/releases/latest)
[![Stream Deck SDK](https://img.shields.io/badge/Stream%20Deck-SDK%20v2-0078D4.svg)](https://docs.elgato.com/)
[![Spotify Web API](https://img.shields.io/badge/Spotify-Web%20API-1DB954.svg)](https://developer.spotify.com/)

An Elgato Stream Deck plugin that lets you add the song currently playing on Spotify to a pre-selected playlist with a single button press.

**Smart Deduplication:** If the song is already in the playlist, it will **not** add it a second time and gives you visual feedback on the button so you know it's already saved.

---

## Features

- 🎵 **One-Click Playlist Saving:** Press the key on your Stream Deck to instantly add the currently playing Spotify song to your chosen playlist.
- 🖼️ **Dynamic Album Art Flash:** The key dynamically displays the song's actual **high-res album cover** with a glowing green badge when saved!
- 💚 **Liked Songs (Your Library) Support:** Add directly to your Spotify **"Liked Songs"** (Lieblingssongs) or any custom playlist.
- 🛡️ **Duplicate Prevention (Smart Deduplication):** Checks your playlist or Liked Songs before adding. If the track is already saved, it safely skips adding it and notifies you on the key.
- 🔀 **Multiple Playlists Support:** Assign different buttons to different playlists (e.g., one button for *"Gym Vibes"*, another for *"Chill"*, and another for *"Liked Songs"*).
- 🔄 **Automatic Token Refresh:** Uses Spotify OAuth 2.0 with offline refresh tokens so you only have to log in once.
- 🎨 **Rich Visual Feedback on Key:** 
  - **Success (Playlist):** Album art + Spotify-green checkmark overlay.
  - **Success (Liked Songs):** Album art + glowing heart badge overlay.
  - **Already Saved:** Album art + amber duplicate alert badge.
  - **Nothing Playing / Not Connected:** Informative alert warning.
- 🖥️ **Native Property Inspector:** Dropdown menu to browse and select all your Spotify playlists with a one-click refresh button.

---

## Installation

### Option 1: One-Click Installer (Recommended)
Double-click the packaged plugin file in this repository:
```
com.spotify-playlist-adder.streamDeckPlugin
```
Elgato Stream Deck will open and install the plugin automatically!

---

### Option 2: Development / Symlink Mode
If you want to edit the code or run in developer mode:
```bash
# 1. Install dependencies
npm install

# 2. Build the plugin
npm run build

# 3. Link plugin to your local Stream Deck installation
npx @elgato/cli link com.spotify-playlist-adder.sdPlugin

# 4. (Optional) Run with auto-reload on changes
npm run watch
```

---

## 1-Minute Spotify Setup

Spotify requires third-party apps to have a Client ID and Client Secret to communicate with your account:

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click **Create app**:
   - **App name:** `Stream Deck Playlist Adder` (or anything you like)
   - **App description:** `Stream Deck Spotify Integration`
   - **Redirect URIs:** Add `http://127.0.0.1:4388/callback`
   - Check the Terms of Service and click **Save**.
3. In your app settings on the dashboard, click **Basic Information** and copy:
   - **Client ID**
   - **Client Secret** (click "View client secret")
4. In the Stream Deck app:
   - Drag **"Add Current Song"** from the **Spotify Playlist Adder** category onto any key.
   - Paste your **Client ID** and **Client Secret** into the Property Inspector.
   - Click **Connect Spotify**.
   - Your browser will open to Spotify's authorization page. Click **Agree**.
   - That's it! Your Stream Deck will now display **"Connected as [Your Name]"**.

---

## How to Use

1. Click on the action key in the Stream Deck software.
2. Under **Target Playlist**, select the playlist you want this button to save songs to from the dropdown.
3. Start listening to any track on Spotify.
4. Press the button on your Stream Deck:
   - If the song is new to the playlist: ✅ Green checkmark appears, and the key temporarily shows `Added! [Track Name]`.
   - If the song is already in the playlist: ⚠️ Key displays `Already in playlist!`, preventing duplicate entries.

---

## Project Structure

```
spotify-streamdeck-playlist-adder/
├── com.spotify-playlist-adder.sdPlugin/    # Stream Deck plugin bundle
│   ├── bin/
│   │   ├── package.json
│   │   └── plugin.js                             # Bundled Node.js runtime code
│   ├── imgs/                                     # High DPI icons (1x and @2x)
│   │   ├── plugin-icon.png
│   │   ├── category-icon.png
│   │   └── actions/
│   │       └── add-to-playlist.png
│   ├── ui/                                       # Stream Deck Property Inspector
│   │   ├── inspector.html
│   │   ├── inspector.css
│   │   └── inspector.js
│   └── manifest.json                             # Plugin manifest schema v2
├── src/
│   ├── actions/
│   │   └── add-to-playlist.ts                    # Key event handler & deduplication
│   ├── services/
│   │   ├── callback-server.ts                    # Local HTTP OAuth redirect listener
│   │   ├── spotify-api.ts                        # Spotify Web API client & cache
│   │   └── spotify-auth.ts                       # Token refresh & credential storage
│   ├── types/
│   │   └── spotify.ts                            # TypeScript interfaces
│   └── plugin.ts                                 # Plugin entry point
├── com.spotify-playlist-adder.streamDeckPlugin # Packaged installer file
├── package.json
├── rollup.config.mjs
├── tsconfig.json
└── README.md
```

---

## 📄 License

This project is open source and available under the terms of the [MIT License](LICENSE).

---

<sub>🤖 *Disclosure: This README and documentation were generated with the assistance of AI.*</sub>
