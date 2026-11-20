import streamDeck, {
  action,
  type KeyDownEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import {
  getFriendlyPlaybackErrorTitle,
  handlePlaybackInspectorMessage,
  onPlaybackStateChange,
  sendPlaybackStatusToInspector
} from "../services/playback-helpers.js";
import { SpotifyApi, SpotifyApiError } from "../services/spotify-api.js";
import { SpotifyAuth } from "../services/spotify-auth.js";
import { MessageToPlugin, PlaybackActionSettings } from "../types/spotify.js";

const POLL_INTERVAL_MS = 5000;

@action({ UUID: "com.spotify-playlist-adder.play-pause" })
export class PlayPauseAction extends SingletonAction<PlaybackActionSettings> {
  private feedbackResetTimers = new Map<string, NodeJS.Timeout>();
  private pollTimer: NodeJS.Timeout | null = null;
  private activeActionIds = new Set<string>();
  private rateLimitedUntil = 0;

  constructor() {
    super();
    onPlaybackStateChange((isPlaying) => {
      void this.updateAllKeyStates(isPlaying);
    });
  }

  override async onWillAppear(ev: WillAppearEvent<PlaybackActionSettings>): Promise<void> {
    this.activeActionIds.add(ev.action.id);
    this.startPollingIfNeeded();
    await this.syncPlaybackState();
  }

  override onWillDisappear(ev: WillDisappearEvent<PlaybackActionSettings>): void {
    this.activeActionIds.delete(ev.action.id);
    const timer = this.feedbackResetTimers.get(ev.action.id);
    if (timer) {
      clearTimeout(timer);
      this.feedbackResetTimers.delete(ev.action.id);
    }
    if (this.activeActionIds.size === 0) {
      this.stopPolling();
    }
  }

  override async onKeyDown(ev: KeyDownEvent<PlaybackActionSettings>): Promise<void> {
    const settings = ev.payload.settings;

    try {
      const isConnected = await SpotifyAuth.isConnected();
      if (!isConnected) {
        streamDeck.logger.warn("Play/Pause pressed but Spotify is not connected.");
        await ev.action.showAlert();
        this.setTemporaryFeedback(ev.action, { title: "Connect\nSpotify", durationMs: 2500 });
        return;
      }

      const accessToken = await SpotifyAuth.getValidAccessToken();
      const { isPlaying, track } = await SpotifyApi.togglePlayPause(accessToken);

      streamDeck.logger.info(`Spotify playback toggled: ${isPlaying ? "Playing" : "Paused"}`);

      // State 0 = Play icon (paused), State 1 = Pause icon (playing)
      await this.updateAllKeyStates(isPlaying);

      if (settings.showAlbumArt !== false && track?.album?.images && track.album.images.length > 0) {
        const chosenImage = track.album.images.find((img) => img.width === 300) || track.album.images[0];
        if (chosenImage?.url) {
          const albumArtDataUri = await SpotifyApi.fetchAlbumArtBase64(chosenImage.url);
          if (albumArtDataUri) {
            const artist = track.artists?.map((a) => a.name).join(", ") || "";
            const fbImage = SpotifyApi.generateFeedbackImage({
              albumArtDataUri,
              badge: isPlaying ? "play" : "pause",
              trackTitle: track.name,
              artist
            });
            this.setTemporaryFeedback(ev.action, { image: fbImage, durationMs: 2000 });
            return;
          }
        }
      }

      await ev.action.showOk();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      streamDeck.logger.error(`Play/Pause error: ${errMsg}`);
      await ev.action.showAlert();
      this.setTemporaryFeedback(ev.action, {
        title: getFriendlyPlaybackErrorTitle(err),
        durationMs: 2500
      });
    }
  }

  override async onPropertyInspectorDidAppear(
    _ev: PropertyInspectorDidAppearEvent<PlaybackActionSettings>
  ): Promise<void> {
    await sendPlaybackStatusToInspector();
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, PlaybackActionSettings>): Promise<void> {
    const payload = ev.payload as MessageToPlugin;
    if (!payload || typeof payload !== "object" || !("event" in payload)) {
      return;
    }
    await handlePlaybackInspectorMessage(payload);
  }

  private startPollingIfNeeded(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.syncPlaybackState();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async syncPlaybackState(): Promise<void> {
    if (this.activeActionIds.size === 0) return;
    if (Date.now() < this.rateLimitedUntil) return;

    try {
      const isConnected = await SpotifyAuth.isConnected();
      if (!isConnected) return;

      const accessToken = await SpotifyAuth.getValidAccessToken();
      const state = await SpotifyApi.getPlaybackState(accessToken);
      const isPlaying = Boolean(state?.is_playing);
      await this.updateAllKeyStates(isPlaying);
    } catch (err) {
      if (err instanceof SpotifyApiError && err.status === 429) {
        this.rateLimitedUntil = Date.now() + 30_000;
        streamDeck.logger.warn("Spotify rate limit hit during playback poll; backing off 30s.");
      }
      // Ignore transient poll errors silently
    }
  }

  private async updateAllKeyStates(isPlaying: boolean): Promise<void> {
    const targetState = isPlaying ? 1 : 0;
    for (const act of this.actions) {
      if (act.isKey()) {
        try {
          await act.setState(targetState);
        } catch {
          // ignore if action is no longer available
        }
      }
    }
  }

  private setTemporaryFeedback(
    act: {
      id: string;
      setTitle: (title?: string) => Promise<void>;
      setImage: (image?: string) => Promise<void>;
    },
    options: { title?: string; image?: string; durationMs: number }
  ): void {
    const existingTimer = this.feedbackResetTimers.get(act.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    if (options.title !== undefined) {
      act.setTitle(options.title).catch(() => {});
    }
    if (options.image !== undefined) {
      act.setImage(options.image).catch(() => {});
    }

    const timer = setTimeout(async () => {
      try {
        await act.setImage(undefined);
        await act.setTitle("");
      } catch {
        // ignore
      } finally {
        this.feedbackResetTimers.delete(act.id);
      }
    }, options.durationMs);

    this.feedbackResetTimers.set(act.id, timer);
  }
}
