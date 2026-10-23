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
import { MessageToPlugin, SpotifyActionSettings } from "../types/spotify.js";

@action({ UUID: "com.spotify-playlist-adder.add" })
export class AddToPlaylistAction extends SingletonAction<SpotifyActionSettings> {
  private titleResetTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Action key pressed down by the user.
   */
  override async onKeyDown(ev: KeyDownEvent<SpotifyActionSettings>): Promise<void> {
    const actionId = ev.action.id;
    const settings = ev.payload.settings;

    try {
      // 1. Check if user is authenticated with Spotify
      const isConnected = await SpotifyAuth.isConnected();
      if (!isConnected) {
        streamDeck.logger.warn("Key pressed but Spotify is not connected.");
        await ev.action.showAlert();
        this.setTemporaryTitle(ev.action, "Connect\nSpotify", 2500);
        return;
      }

      // 2. Check if a target playlist is selected
      const playlistId = settings.playlistId;
      const playlistName = settings.playlistName || "Playlist";
      if (!playlistId) {
        streamDeck.logger.warn("Key pressed but no playlist is selected in settings.");
        await ev.action.showAlert();
        this.setTemporaryTitle(ev.action, "Select\nPlaylist", 2500);
        return;
      }

      // 3. Obtain valid access token (refreshes automatically if expired)
      const accessToken = await SpotifyAuth.getValidAccessToken();

      // 4. Retrieve currently playing track
      const track = await SpotifyApi.getCurrentlyPlaying(accessToken);
      if (!track) {
        streamDeck.logger.info("Nothing is currently playing on Spotify.");
        await ev.action.showAlert();
        this.setTemporaryTitle(ev.action, "Nothing\nPlaying", 2500);
        return;
      }

      const trackUri = track.uri;
      const trackId = track.id;
      const trackTitle = track.name || "Track";
      const artist = track.artists && track.artists.length > 0
        ? track.artists.map((a) => a.name).join(", ")
        : "";

      streamDeck.logger.info(`Detected track: "${trackTitle}" by ${artist} (${trackUri})`);

      // 5. Check if track already exists in the playlist (Deduplication)
      let alreadyInPlaylist = false;
      try {
        alreadyInPlaylist = await SpotifyApi.isTrackInPlaylist(accessToken, playlistId, trackUri, trackId);
      } catch (checkErr) {
        streamDeck.logger.warn(`Could not verify duplicate status: ${checkErr}`);
      }

      if (alreadyInPlaylist) {
        streamDeck.logger.info(`Track "${trackTitle}" is already in playlist "${playlistName}". Not adding duplicate.`);
        await ev.action.showAlert();
        this.setTemporaryTitle(ev.action, "Already in\nplaylist!", 2500);
        return;
      }

      // 6. Add track to the chosen playlist
      await SpotifyApi.addTrackToPlaylist(accessToken, playlistId, trackUri);
      streamDeck.logger.info(`Successfully added "${trackTitle}" to "${playlistName}".`);

      // 7. Visual feedback: Stream Deck checkmark & optional title feedback
      await ev.action.showOk();
      if (settings.showTrackTitleOnKey !== false) {
        const truncated = trackTitle.length > 18 ? trackTitle.slice(0, 16) + "..." : trackTitle;
        this.setTemporaryTitle(ev.action, `Added!\n${truncated}`, 2500);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      streamDeck.logger.error(`Error adding track to playlist: ${errMsg}`);
      await ev.action.showAlert();
      this.setTemporaryTitle(ev.action, "Error!", 2500);
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

          // Fetch playlists immediately for the user
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

        // Update button title to reflect playlist name
        if (payload.playlistName && updatedSettings.showTrackTitleOnKey !== false) {
          const name = payload.playlistName.length > 16
            ? payload.playlistName.slice(0, 14) + "..."
            : payload.playlistName;
          await action.setTitle(name);
        }

        // Clear cached tracks for previous playlist
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
   * Helper to show a temporary title on the key, restoring the previous title after duration.
   */
  private setTemporaryTitle(action: { id: string; setTitle: (title?: string) => Promise<void>; getSettings: () => Promise<SpotifyActionSettings> }, title: string, durationMs: number): void {
    const existingTimer = this.titleResetTimers.get(action.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    action.setTitle(title).catch(() => {});

    const timer = setTimeout(async () => {
      try {
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
        this.titleResetTimers.delete(action.id);
      }
    }, durationMs);

    this.titleResetTimers.set(action.id, timer);
  }
}
