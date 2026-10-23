import streamDeck from "@elgato/streamdeck";
import crypto from "node:crypto";
import { SpotifyGlobalSettings } from "../types/spotify.js";
import { CallbackServer } from "./callback-server.js";
import { SpotifyApi } from "./spotify-api.js";

export class SpotifyAuth {
  private static callbackServer = new CallbackServer(4388);

  /**
   * Retrieves the current global settings.
   */
  public static async getSettings(): Promise<SpotifyGlobalSettings> {
    return (await streamDeck.settings.getGlobalSettings<SpotifyGlobalSettings>()) || {};
  }

  /**
   * Saves updated global settings.
   */
  public static async saveSettings(settings: SpotifyGlobalSettings): Promise<void> {
    await streamDeck.settings.setGlobalSettings(settings);
  }

  /**
   * Checks if user has connected their Spotify account.
   */
  public static async isConnected(): Promise<boolean> {
    const settings = await this.getSettings();
    return Boolean(settings.clientId && settings.accessToken && settings.refreshToken);
  }

  /**
   * Gets a valid access token. Automatically refreshes if token is expired or close to expiring.
   */
  public static async getValidAccessToken(): Promise<string> {
    const settings = await this.getSettings();

    if (!settings.accessToken || !settings.refreshToken || !settings.clientId || !settings.clientSecret) {
      throw new Error("Spotify is not connected. Please configure your credentials in the Property Inspector.");
    }

    const now = Date.now();
    const expiresAt = settings.expiresAt || 0;

    // If token has expired or will expire in the next 60 seconds, refresh it
    if (now >= expiresAt - 60000) {
      streamDeck.logger.info("Spotify access token expired or expiring soon. Refreshing...");
      try {
        const tokenData = await SpotifyApi.refreshAccessToken(
          settings.clientId,
          settings.clientSecret,
          settings.refreshToken
        );

        const newExpiresAt = Date.now() + tokenData.expires_in * 1000;
        settings.accessToken = tokenData.access_token;
        settings.expiresAt = newExpiresAt;
        if (tokenData.refresh_token) {
          settings.refreshToken = tokenData.refresh_token;
        }

        await this.saveSettings(settings);
        streamDeck.logger.info("Spotify access token refreshed successfully.");
        return tokenData.access_token;
      } catch (err) {
        streamDeck.logger.error(`Failed to refresh Spotify token: ${err}`);
        throw new Error("Failed to refresh Spotify access token. Please re-authenticate.");
      }
    }

    return settings.accessToken;
  }

  /**
   * Starts the OAuth authorization flow:
   * 1. Opens local HTTP server on port 4388
   * 2. Opens user's default browser to Spotify authorize page
   * 3. Awaits redirect with authorization code
   * 4. Exchanges code for tokens and saves them
   */
  public static async startAuthorization(
    clientId: string,
    clientSecret: string
  ): Promise<{ userDisplayName: string; userId: string }> {
    const state = crypto.randomBytes(16).toString("hex");
    const redirectUri = this.callbackServer.redirectUri;
    const authUrl = SpotifyApi.getAuthorizationUrl(clientId, redirectUri, state);

    streamDeck.logger.info(`Starting Spotify OAuth flow. Redirect URI: ${redirectUri}`);

    // Start listening on local server BEFORE opening the browser
    const listenPromise = this.callbackServer.listenForCode(state);

    // Open browser to auth URL
    await streamDeck.system.openUrl(authUrl);

    // Await the callback
    const result = await listenPromise;
    if (result.error || !result.code) {
      throw new Error(result.error || "Authorization was cancelled or failed.");
    }

    streamDeck.logger.info("Authorization code received. Exchanging for tokens...");

    // Exchange code for tokens
    const tokens = await SpotifyApi.exchangeCodeForTokens(clientId, clientSecret, result.code, redirectUri);
    const expiresAt = Date.now() + tokens.expires_in * 1000;

    // Fetch user profile
    const userProfile = await SpotifyApi.getCurrentUser(tokens.access_token);

    // Save credentials in global settings
    const settings: SpotifyGlobalSettings = {
      clientId,
      clientSecret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      userId: userProfile.id,
      userDisplayName: userProfile.display_name || userProfile.id,
      userEmail: userProfile.email
    };

    await this.saveSettings(settings);
    streamDeck.logger.info(`Successfully connected as Spotify user: ${settings.userDisplayName}`);

    return {
      userDisplayName: settings.userDisplayName || userProfile.id || "Spotify User",
      userId: settings.userId || userProfile.id || ""
    };
  }

  /**
   * Disconnects / logs out by removing Spotify tokens from settings.
   */
  public static async disconnect(): Promise<void> {
    const settings = await this.getSettings();
    delete settings.accessToken;
    delete settings.refreshToken;
    delete settings.expiresAt;
    delete settings.userDisplayName;
    delete settings.userId;
    delete settings.userEmail;

    await this.saveSettings(settings);
    SpotifyApi.clearCache();
    streamDeck.logger.info("Spotify disconnected.");
  }
}
