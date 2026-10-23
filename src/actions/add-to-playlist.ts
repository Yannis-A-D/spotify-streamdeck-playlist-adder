import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  SingletonAction,
  type WillAppearEvent
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import { SpotifyApi } from "../services/spotify-api.js";
import { SpotifyAuth } from "../services/spotify-auth.js";
import { LIKED_SONGS_PLAYLIST_ID, MessageToPlugin, SpotifyActionSettings } from "../types/spotify.js";

@action({ UUID: "com.spotify-playlist-adder.add" })
export class AddToPlaylistAction extends SingletonAction<SpotifyActionSettings> {
  private feedbackResetTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Action key pressed down by the user.
   */
  override async onKeyDown(ev: KeyDownEvent<SpotifyActionSettings>): Promise<void> {
    const settings = ev.payload.settings;

    try {
      // 1. Check if user is authenticated with Spotify
      const isConnected = await SpotifyAuth.isConnected();
      if (!isConnected) {
        streamDeck.logger.warn("Key pressed but Spotify is not connected.");
        await ev.action.showAlert();
        this.setTemporaryFeedback(ev.action, { title: "Connect\nSpotify", durationMs: 2500 });
        return;
      }

      // 2. Check if a target playlist is selected
      const playlistId = settings.playlistId;
      const isLikedSongs = playlistId === LIKED_SONGS_PLAYLIST_ID;
      const playlistName = isLikedSongs ? "Liked Songs" : (settings.playlistName || "Playlist");

      if (!playlistId) {
        streamDeck.logger.warn("Key pressed but no playlist is selected in settings.");
        await ev.action.showAlert();
        this.setTemporaryFeedback(ev.action, { title: "Select\nPlaylist", durationMs: 2500 });
        return;
      }

      // 3. Obtain valid access token (refreshes automatically if expired)
      const accessToken = await SpotifyAuth.getValidAccessToken();

      // 4. Retrieve currently playing track
      const track = await SpotifyApi.getCurrentlyPlaying(accessToken);
      if (!track) {
        streamDeck.logger.info("Nothing is currently playing on Spotify.");
        await ev.action.showAlert();
        this.setTemporaryFeedback(ev.action, { title: "Nothing\nPlaying", durationMs: 2500 });
        return;
      }

      const trackUri = track.uri;
      const trackId = track.id;
      const trackTitle = track.name || "Track";
      const artist = track.artists && track.artists.length > 0
        ? track.artists.map((a) => a.name).join(", ")
        : "";

      streamDeck.logger.info(`Detected track: "${trackTitle}" by ${artist} (${trackUri})`);

      // 5. Download Album Art if enabled (default true)
      let albumArtDataUri: string | null = null;
      if (settings.showAlbumArt !== false && track.album?.images && track.album.images.length > 0) {
        const chosenImage = track.album.images.find((img) => img.width === 300) || track.album.images[0];
        if (chosenImage?.url) {
          albumArtDataUri = await SpotifyApi.fetchAlbumArtBase64(chosenImage.url);
        }
      }

      // 6. Branch: Liked Songs vs Custom Playlist
      if (isLikedSongs) {
        // Liked Songs Deduplication
        let alreadyLiked = false;
        try {
          alreadyLiked = await SpotifyApi.isLikedSong(accessToken, trackId);
        } catch (checkErr) {
          streamDeck.logger.warn(`Could not verify liked songs status: ${checkErr}`);
        }

        if (alreadyLiked) {
          streamDeck.logger.info(`Track "${trackTitle}" is already in Liked Songs. Skipped duplicate.`);
          await ev.action.showAlert();
          if (albumArtDataUri) {
            const fbImage = SpotifyApi.generateFeedbackImage({
              albumArtDataUri,
              badge: "duplicate",
              trackTitle,
              artist
            });
            await this.setTemporaryFeedback(ev.action, { image: fbImage, durationMs: 3000 });
          } else {
            this.setTemporaryFeedback(ev.action, { title: "Already in\nLiked Songs!", durationMs: 2500 });
          }
          return;
        }

        // Add to Liked Songs
        await SpotifyApi.addToLikedSongs(accessToken, trackId);
        streamDeck.logger.info(`Successfully added "${trackTitle}" to Liked Songs.`);

        await ev.action.showOk();
        if (albumArtDataUri) {
          const fbImage = SpotifyApi.generateFeedbackImage({
            albumArtDataUri,
            badge: "success_liked",
            trackTitle,
            artist
          });
          await this.setTemporaryFeedback(ev.action, { image: fbImage, durationMs: 3500 });
        } else {
          this.setTemporaryFeedback(ev.action, { title: "Saved to\nLiked Songs 💚", durationMs: 2500 });
        }
      } else {
        // Custom Playlist Deduplication
        let alreadyInPlaylist = false;
        try {
          alreadyInPlaylist = await SpotifyApi.isTrackInPlaylist(accessToken, playlistId, trackUri, trackId);
        } catch (checkErr) {
          streamDeck.logger.warn(`Could not verify duplicate status: ${checkErr}`);
        }

        if (alreadyInPlaylist) {
          streamDeck.logger.info(`Track "${trackTitle}" is already in playlist "${playlistName}". Skipped duplicate.`);
          await ev.action.showAlert();
          if (albumArtDataUri) {
            const fbImage = SpotifyApi.generateFeedbackImage({
              albumArtDataUri,
              badge: "duplicate",
              trackTitle,
              artist
            });
            await this.setTemporaryFeedback(ev.action, { image: fbImage, durationMs: 3000 });
          } else {
            this.setTemporaryFeedback(ev.action, { title: "Already in\nplaylist!", durationMs: 2500 });
          }
          return;
        }

        // Add to chosen playlist
        await SpotifyApi.addTrackToPlaylist(accessToken, playlistId, trackUri);
        streamDeck.logger.info(`Successfully added "${trackTitle}" to "${playlistName}".`);

        await ev.action.showOk();
        if (albumArtDataUri) {
          const fbImage = SpotifyApi.generateFeedbackImage({
            albumArtDataUri,
            badge: "success_playlist",
            trackTitle,
            artist
          });
          await this.setTemporaryFeedback(ev.action, { image: fbImage, durationMs: 3500 });
        } else if (settings.showTrackTitleOnKey !== false) {
          const truncated = trackTitle.length > 18 ? trackTitle.slice(0, 16) + "..." : trackTitle;
          this.setTemporaryFeedback(ev.action, { title: `Added!\n${truncated}`, durationMs: 2500 });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      streamDeck.logger.error(`Error processing track: ${errMsg}`);
      await ev.action.showAlert();
      this.setTemporaryFeedback(ev.action, { title: "Error!", durationMs: 2500 });
    }
  }

  /**
   * Action appears on Stream Deck.
   */
  override async onWillAppear(ev: WillAppearEvent<SpotifyActionSettings>): Promise<void> {
    const settings = ev.payload.settings;
    if (settings.playlistName && settings.showTrackTitleOnKey !== false) {
      const name = settings.playlistName.length > 16
        ? settings.playlistName.slice(0, 14) + "..."
        : settings.playlistName;
      await ev.action.setTitle(name);
    }
  }

  /**
   * Settings updated in Property Inspector.
   */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SpotifyActionSettings>): Promise<void> {
    const settings = ev.payload.settings;
    if (settings.playlistName && settings.showTrackTitleOnKey !== false) {
      const name = settings.playlistName.length > 16
        ? settings.playlistName.slice(0, 14) + "..."
        : settings.playlistName;
      await ev.action.setTitle(name);
    }
  }

  /**
   * Property Inspector opened for this action.
   */
  override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<SpotifyActionSettings>): Promise<void> {
    await this.sendStatusToPropertyInspector(ev.action, ev.action.getSettings());
  }

  /**
   * Handles messages sent from the Property Inspector UI.
   */
  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, SpotifyActionSettings>): Promise<void> {
    const payload = ev.payload as MessageToPlugin;
    const action = ev.action;

    if (!payload || typeof payload !== "object" || !("event" in payload)) {
      return;
    }

    switch (payload.event) {
      case "getStatus": {
        await this.sendStatusToPropertyInspector(action, action.getSettings());
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

          const token = await SpotifyAuth.getValidAccessToken();
          const playlists = await SpotifyApi.getUserPlaylists(token);

          await streamDeck.ui.sendToPropertyInspector({
            event: "status",
            connected: true,
            userDisplayName: result.userDisplayName,
            clientId: payload.clientId,
            playlists: playlists
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

      case "getPlaylists": {
        try {
          const isConnected = await SpotifyAuth.isConnected();
          if (!isConnected) {
            await streamDeck.ui.sendToPropertyInspector({
              event: "error",
              message: "Spotify is not connected."
            });
            return;
          }

          const token = await SpotifyAuth.getValidAccessToken();
          const playlists = await SpotifyApi.getUserPlaylists(token);

          await streamDeck.ui.sendToPropertyInspector({
            event: "playlists",
            playlists: playlists
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await streamDeck.ui.sendToPropertyInspector({
            event: "error",
            message: errMsg
          });
        }
        break;
      }

      case "selectPlaylist": {
        const currentSettings = await action.getSettings<SpotifyActionSettings>();
        const updatedSettings: SpotifyActionSettings = {
          ...currentSettings,
          playlistId: payload.playlistId,
          playlistName: payload.playlistName
        };

        await action.setSettings(updatedSettings);

        if (payload.playlistName && updatedSettings.showTrackTitleOnKey !== false) {
          const name = payload.playlistName.length > 16
            ? payload.playlistName.slice(0, 14) + "..."
            : payload.playlistName;
          await action.setTitle(name);
        }

        SpotifyApi.clearCache();
        break;
      }
    }
  }

  /**
   * Helper to send full status to the Property Inspector.
   */
  private async sendStatusToPropertyInspector(
    action: { getSettings: () => Promise<SpotifyActionSettings> },
    settingsPromise?: Promise<SpotifyActionSettings>
  ): Promise<void> {
    try {
      const globalSettings = await SpotifyAuth.getSettings();
      const isConnected = Boolean(globalSettings.clientId && globalSettings.accessToken && globalSettings.refreshToken);
      const actionSettings = await (settingsPromise || action.getSettings());

      let playlists: Array<{ id: string; name: string; total: number }> = [];
      if (isConnected) {
        try {
          const token = await SpotifyAuth.getValidAccessToken();
          playlists = await SpotifyApi.getUserPlaylists(token);
        } catch (err) {
          streamDeck.logger.warn(`Could not preload playlists: ${err}`);
        }
      }

      await streamDeck.ui.sendToPropertyInspector({
        event: "status",
        connected: isConnected,
        userDisplayName: globalSettings.userDisplayName,
        clientId: globalSettings.clientId,
        playlists: playlists,
        selectedPlaylistId: actionSettings.playlistId
      });
    } catch (err) {
      streamDeck.logger.error(`Error sending status to Property Inspector: ${err}`);
    }
  }

  /**
   * Shows temporary feedback (title and/or dynamic album art image), then restores original state.
   */
  private setTemporaryFeedback(
    action: {
      id: string;
      setTitle: (title?: string) => Promise<void>;
      setImage: (image?: string) => Promise<void>;
      getSettings: () => Promise<SpotifyActionSettings>;
    },
    options: { title?: string; image?: string; durationMs: number }
  ): void {
    const existingTimer = this.feedbackResetTimers.get(action.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    if (options.title !== undefined) {
      action.setTitle(options.title).catch(() => {});
    }
    if (options.image !== undefined) {
      action.setImage(options.image).catch(() => {});
    }

    const timer = setTimeout(async () => {
      try {
        // Reset image back to manifest default
        await action.setImage(undefined);

        const currentSettings = await action.getSettings();
        if (currentSettings.playlistName && currentSettings.showTrackTitleOnKey !== false) {
          const name = currentSettings.playlistName.length > 16
            ? currentSettings.playlistName.slice(0, 14) + "..."
            : currentSettings.playlistName;
          await action.setTitle(name);
        } else {
          await action.setTitle("");
        }
      } catch {
        // ignore
      } finally {
        this.feedbackResetTimers.delete(action.id);
      }
    }, options.durationMs);

    this.feedbackResetTimers.set(action.id, timer);
  }
}
