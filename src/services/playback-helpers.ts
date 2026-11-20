import streamDeck from "@elgato/streamdeck";
import { MessageToPlugin } from "../types/spotify.js";
import { SpotifyApi, SpotifyApiError } from "./spotify-api.js";
import { SpotifyAuth } from "./spotify-auth.js";

type PlaybackStateListener = (isPlaying: boolean) => void;
const playbackStateListeners = new Set<PlaybackStateListener>();

/**
 * Registers a listener to be notified when playback state changes from any action.
 */
export function onPlaybackStateChange(listener: PlaybackStateListener): () => void {
  playbackStateListeners.add(listener);
  return () => playbackStateListeners.delete(listener);
}

/**
 * Notifies all registered playback state listeners (e.g., Play/Pause keys).
 */
export function notifyPlaybackStateChange(isPlaying: boolean): void {
  for (const listener of playbackStateListeners) {
    try {
      listener(isPlaying);
    } catch {
      // ignore listener errors
    }
  }
}

/**
 * Maps Spotify API errors to short, actionable titles for Stream Deck keys.
 */
export function getFriendlyPlaybackErrorTitle(err: unknown): string {
  if (err instanceof SpotifyApiError) {
    const msgLower = err.message.toLowerCase();
    if (err.status === 403 && msgLower.includes("scope")) {
      return "Reconnect\nSpotify";
    }
    if (err.reason === "PREMIUM_REQUIRED" || msgLower.includes("premium")) {
      return "Premium\nRequired";
    }
    if (err.status === 404 || err.reason === "NO_ACTIVE_DEVICE" || msgLower.includes("no active device")) {
      return "No Active\nDevice";
    }
    if (err.status === 429) {
      return "Rate\nLimited";
    }
    if (err.status === 401) {
      return "Reconnect\nSpotify";
    }
  }

  return "Error!";
}

/**
 * Sends Spotify connection status to the Property Inspector (for playback actions that don't need playlists).
 */
export async function sendPlaybackStatusToInspector(): Promise<void> {
  try {
    const globalSettings = await SpotifyAuth.getSettings();
    const isConnected = Boolean(globalSettings.clientId && globalSettings.accessToken && globalSettings.refreshToken);

    await streamDeck.ui.sendToPropertyInspector({
      event: "status",
      connected: isConnected,
      userDisplayName: globalSettings.userDisplayName,
      clientId: globalSettings.clientId
    });
  } catch (err) {
    streamDeck.logger.error(`Error sending playback status to Property Inspector: ${err}`);
  }
}

/**
 * Handles common auth-related messages from the Property Inspector for playback actions.
 */
export async function handlePlaybackInspectorMessage(payload: MessageToPlugin): Promise<void> {
  switch (payload.event) {
    case "getStatus": {
      await sendPlaybackStatusToInspector();
      break;
    }

    case "startAuth": {
      try {
        await streamDeck.ui.sendToPropertyInspector({
          event: "authProgress",
          status: "listening",
          message: "Waiting for browser login..."
        });

        const result = await SpotifyAuth.startAuthorization(payload.clientId, payload.clientSecret);

        await streamDeck.ui.sendToPropertyInspector({
          event: "authProgress",
          status: "success",
          message: `Connected as ${result.userDisplayName}!`
        });

        await streamDeck.ui.sendToPropertyInspector({
          event: "status",
          connected: true,
          userDisplayName: result.userDisplayName,
          clientId: payload.clientId
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        streamDeck.logger.error(`OAuth error: ${errMsg}`);
        await streamDeck.ui.sendToPropertyInspector({
          event: "authProgress",
          status: "error",
          message: errMsg
        });
      }
      break;
    }

    case "disconnect": {
      await SpotifyAuth.disconnect();
      await streamDeck.ui.sendToPropertyInspector({
        event: "status",
        connected: false
      });
      break;
    }
  }
}

/**
 * Small async delay helper.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
