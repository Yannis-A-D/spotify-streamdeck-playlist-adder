import streamDeck from "@elgato/streamdeck";
import {
  SpotifyPlaybackResponse,
  SpotifyPlaylistTracksResponse,
  SpotifyPlaylistsResponse,
  SpotifyTokenResponse,
  SpotifyTrack,
  SpotifyUserResponse
} from "../types/spotify.js";

interface PlaylistCacheEntry {
  tracks: Set<string>;
  timestamp: number;
}

export class SpotifyApi {
  private static readonly SCOPES = [
    "user-read-currently-playing",
    "user-read-playback-state",
    "user-read-private",
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-public",
    "playlist-modify-private",
    "user-library-read",
    "user-library-modify"
  ].join(" ");

  // In-memory cache of playlist track URIs & IDs to make duplicate checking near-instantaneous
  private static playlistTrackCache = new Map<string, PlaylistCacheEntry>();
  private static readonly CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

  /**
   * Generates Spotify authorization URL for OAuth 2.0 flow.
   */
  public static getAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: this.SCOPES,
      redirect_uri: redirectUri,
      state: state,
      show_dialog: "true"
    });
    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  /**
   * Exchanges authorization code for access and refresh tokens.
   */
  public static async exchangeCodeForTokens(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
  ): Promise<SpotifyTokenResponse> {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri
    });

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Spotify token exchange failed (${response.status}): ${errorText}`);
    }

    return (await response.json()) as SpotifyTokenResponse;
  }

  /**
   * Refreshes access token using the refresh token.
   */
  public static async refreshAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string
  ): Promise<SpotifyTokenResponse> {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Spotify token refresh failed (${response.status}): ${errorText}`);
    }

    return (await response.json()) as SpotifyTokenResponse;
  }

  /**
   * Retrieves profile of current user.
   */
  public static async getCurrentUser(accessToken: string): Promise<SpotifyUserResponse> {
    const response = await fetch("https://api.spotify.com/v1/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch Spotify user profile (${response.status}): ${errorText}`);
    }

    return (await response.json()) as SpotifyUserResponse;
  }

  /**
   * Retrieves all playlists for the current user (with pagination).
   */
  public static async getUserPlaylists(accessToken: string, maxPlaylists = 150): Promise<Array<{ id: string; name: string; total: number }>> {
    const playlists: Array<{ id: string; name: string; total: number }> = [];
    let nextUrl: string | null = `https://api.spotify.com/v1/me/playlists?limit=50`;

    while (nextUrl && playlists.length < maxPlaylists) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch playlists (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as SpotifyPlaylistsResponse;
      for (const item of data.items) {
        if (item && item.id && item.name) {
          playlists.push({
            id: item.id,
            name: item.name,
            total: item.tracks?.total ?? 0
          });
        }
      }

      nextUrl = data.next;
    }

    return playlists;
  }

  /**
   * Retrieves the currently playing track/episode.
   * Returns null if nothing is currently playing.
   */
  public static async getCurrentlyPlaying(accessToken: string): Promise<SpotifyTrack | null> {
    const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing?additional_types=track", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch currently playing track (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as SpotifyPlaybackResponse;
    if (!data || !data.item) {
      return null;
    }

    return data.item;
  }

  /**
   * Checks if a track (by URI or ID) already exists in the given playlist.
   * Uses cached track set when available to minimize API latency.
   * If checking fails (e.g. permission restriction), returns false gracefully.
   */
  public static async isTrackInPlaylist(
    accessToken: string,
    playlistId: string,
    trackUri: string,
    trackId: string
  ): Promise<boolean> {
    const now = Date.now();
    let cache = this.playlistTrackCache.get(playlistId);

    // If cache is missing or stale, fetch tracks from Spotify
    if (!cache || now - cache.timestamp > this.CACHE_TTL_MS) {
      try {
        const trackSet = await this.fetchAllPlaylistTrackIdentifiers(accessToken, playlistId);
        cache = { tracks: trackSet, timestamp: now };
        this.playlistTrackCache.set(playlistId, cache);
      } catch (err) {
        streamDeck.logger.warn(`Could not verify playlist tracks for deduplication: ${err}`);
        return false;
      }
    }

    return cache.tracks.has(trackUri) || cache.tracks.has(trackId);
  }

  /**
   * Adds a track to a playlist and updates the local cache.
   * Supports both modern /items and legacy /tracks Spotify endpoints.
   */
  public static async addTrackToPlaylist(accessToken: string, playlistId: string, trackUri: string): Promise<void> {
    const payload = JSON.stringify({ uris: [trackUri] });

    // 1. Try modern /items endpoint first
    let response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: payload
    });

    // 2. Fallback to /tracks endpoint if /items returned 404
    if (response.status === 404) {
      streamDeck.logger.info("Retrying addTrackToPlaylist with /tracks fallback endpoint...");
      response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: payload
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add track to playlist (${response.status}): ${errorText}`);
    }

    // Immediately update local cache so any subsequent button press knows it's already there!
    const cache = this.playlistTrackCache.get(playlistId);
    if (cache) {
      cache.tracks.add(trackUri);
      const parts = trackUri.split(":");
      if (parts.length === 3) {
        cache.tracks.add(parts[2]);
      }
    }
  }

  /**
   * Checks if a track is in the user's Liked Songs library.
   */
  public static async isLikedSong(accessToken: string, trackId: string): Promise<boolean> {
    const response = await fetch(`https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      streamDeck.logger.warn(`Failed to check if song is liked (${response.status}): ${errorText}`);
      return false;
    }

    const data = (await response.json()) as boolean[];
    return Boolean(data && data[0]);
  }

  /**
   * Adds a track to the user's Liked Songs library.
   */
  public static async addToLikedSongs(accessToken: string, trackId: string): Promise<void> {
    const response = await fetch(`https://api.spotify.com/v1/me/tracks`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ids: [trackId]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add song to Liked Songs (${response.status}): ${errorText}`);
    }
  }

  /**
   * Downloads album cover and converts it to a base64 data URI.
   */
  public static async fetchAlbumArtBase64(imageUrl: string): Promise<string | null> {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      return `data:${contentType};base64,${base64}`;
    } catch (err) {
      streamDeck.logger.warn(`Could not download album art: ${err}`);
      return null;
    }
  }

  /**
   * Generates a high-quality SVG data URI for Stream Deck displaying album art and action status badge.
   */
  public static generateFeedbackImage(options: {
    albumArtDataUri?: string | null;
    badge: "success_playlist" | "success_liked" | "duplicate" | "nothing";
    trackTitle?: string;
    artist?: string;
  }): string {
    const { albumArtDataUri, badge, trackTitle, artist } = options;

    let badgeSvg = "";
    if (badge === "success_playlist") {
      badgeSvg = `
        <circle cx="116" cy="28" r="18" fill="#1DB954" filter="drop-shadow(0px 2px 4px rgba(0,0,0,0.6))"/>
        <path d="M107 28l6 6 12-12" stroke="#000" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      `;
    } else if (badge === "success_liked") {
      badgeSvg = `
        <circle cx="116" cy="28" r="18" fill="#1DB954" filter="drop-shadow(0px 2px 4px rgba(0,0,0,0.6))"/>
        <path d="M116 35s-8-5.2-8-9.4c0-2.3 1.8-4.1 4.1-4.1 1.7 0 3.2 1 3.9 2.4.7-1.4 2.2-2.4 3.9-2.4 2.3 0 4.1 1.8 4.1 4.1 0 4.2-8 9.4-8 9.4z" fill="#000"/>
      `;
    } else if (badge === "duplicate") {
      badgeSvg = `
        <circle cx="116" cy="28" r="18" fill="#f59e0b" filter="drop-shadow(0px 2px 4px rgba(0,0,0,0.6))"/>
        <path d="M116 19v10M116 33v2" stroke="#000" stroke-width="3.5" stroke-linecap="round"/>
      `;
    }

    const titleEscaped = escapeSvg(trackTitle ? (trackTitle.length > 15 ? trackTitle.slice(0, 14) + "..." : trackTitle) : "");
    const artistEscaped = escapeSvg(artist ? (artist.length > 18 ? artist.slice(0, 17) + "..." : artist) : "");

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
        <rect width="144" height="144" rx="20" fill="#121212"/>
        ${albumArtDataUri ? `<clipPath id="clip"><rect width="144" height="144" rx="20"/></clipPath><image href="${albumArtDataUri}" width="144" height="144" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip)"/>` : ""}
        <rect y="84" width="144" height="60" rx="20" fill="url(#bottomGrad)"/>
        <defs>
          <linearGradient id="bottomGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
            <stop offset="40%" stop-color="rgba(0,0,0,0.7)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0.95)"/>
          </linearGradient>
        </defs>
        ${badgeSvg}
        ${titleEscaped ? `<text x="72" y="118" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" text-anchor="middle">${titleEscaped}</text>` : ""}
        ${artistEscaped ? `<text x="72" y="133" fill="#b3b3b3" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" text-anchor="middle">${artistEscaped}</text>` : ""}
      </svg>
    `;

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
  }

  /**
   * Clears cached tracks for a specific playlist or all playlists.
   */
  public static clearCache(playlistId?: string): void {
    if (playlistId) {
      this.playlistTrackCache.delete(playlistId);
    } else {
      this.playlistTrackCache.clear();
    }
  }

  /**
   * Internal helper to fetch track URIs and IDs from a playlist.
   * Tries /items endpoint first, then /tracks, handles query params safely.
   */
  private static async fetchAllPlaylistTrackIdentifiers(accessToken: string, playlistId: string): Promise<Set<string>> {
    const trackSet = new Set<string>();

    // Try modern /items endpoint first, fallback to /tracks
    let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/items?fields=items(track(id,uri)),next&limit=100&additional_types=track`;

    let pageCount = 0;
    const maxPages = 20; // Check up to 2,000 tracks

    while (nextUrl && pageCount < maxPages) {
      pageCount++;
      let response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      // If /items gives 404 or 403, try without /items (standard /tracks)
      if (!response.ok && pageCount === 1) {
        const fallbackUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?fields=items(track(id,uri)),next&limit=100&additional_types=track`;
        const fallbackResponse = await fetch(fallbackUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });
        if (fallbackResponse.ok) {
          response = fallbackResponse;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        streamDeck.logger.warn(`Could not read all playlist items (${response.status}): ${errorText}`);
        break; // Return whatever tracks we collected rather than crashing
      }

      const data = (await response.json()) as SpotifyPlaylistTracksResponse;
      if (data && data.items) {
        for (const item of data.items) {
          if (item?.track) {
            if (item.track.uri) trackSet.add(item.track.uri);
            if (item.track.id) trackSet.add(item.track.id);
          }
        }
      }

      nextUrl = data.next;
    }

    return trackSet;
  }
}

function escapeSvg(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
