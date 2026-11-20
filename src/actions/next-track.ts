import streamDeck, {
  action,
  type KeyDownEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  SingletonAction,
  type WillDisappearEvent
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import {
  delay,
  getFriendlyPlaybackErrorTitle,
  handlePlaybackInspectorMessage,
  notifyPlaybackStateChange,
  sendPlaybackStatusToInspector
} from "../services/playback-helpers.js";
import { SpotifyApi } from "../services/spotify-api.js";
import { SpotifyAuth } from "../services/spotify-auth.js";
import { MessageToPlugin, PlaybackActionSettings } from "../types/spotify.js";

@action({ UUID: "com.spotify-playlist-adder.next" })
export class NextTrackAction extends SingletonAction<PlaybackActionSettings> {
  private feedbackResetTimers = new Map<string, NodeJS.Timeout>();

  override onWillDisappear(ev: WillDisappearEvent<PlaybackActionSettings>): void {
    const timer = this.feedbackResetTimers.get(ev.action.id);
    if (timer) {
      clearTimeout(timer);
      this.feedbackResetTimers.delete(ev.action.id);
    }
  }

  override async onKeyDown(ev: KeyDownEvent<PlaybackActionSettings>): Promise<void> {
    const settings = ev.payload.settings;

    try {
      const isConnected = await SpotifyAuth.isConnected();
      if (!isConnected) {
        streamDeck.logger.warn("Next Track pressed but Spotify is not connected.");
        await ev.action.showAlert();
        this.setTemporaryFeedback(ev.action, { title: "Connect\nSpotify", durationMs: 2500 });
        return;
      }

      const accessToken = await SpotifyAuth.getValidAccessToken();
      await SpotifyApi.skipToNext(accessToken);
      streamDeck.logger.info("Skipped to next Spotify track.");

      notifyPlaybackStateChange(true);

      if (settings.showAlbumArt !== false) {
        // Brief pause so Spotify updates the currently playing track
        await delay(350);
        try {
          const track = await SpotifyApi.getCurrentlyPlaying(accessToken);
          const chosenImage = track?.album?.images?.find((img) => img.width === 300) || track?.album?.images?.[0];
          if (track && chosenImage?.url) {
            const albumArtDataUri = await SpotifyApi.fetchAlbumArtBase64(chosenImage.url);
            if (albumArtDataUri) {
              const artist = track.artists?.map((a) => a.name).join(", ") || "";
              const fbImage = SpotifyApi.generateFeedbackImage({
                albumArtDataUri,
                badge: "next",
                trackTitle: track.name,
                artist
              });
              this.setTemporaryFeedback(ev.action, { image: fbImage, durationMs: 2500 });
              return;
            }
          }
        } catch (fbErr) {
          streamDeck.logger.warn(`Skipped track, but could not load album art feedback: ${fbErr}`);
        }
      }

      await ev.action.showOk();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      streamDeck.logger.error(`Next Track error: ${errMsg}`);
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
