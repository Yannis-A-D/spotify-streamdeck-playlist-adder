import type { JsonObject, JsonValue } from "@elgato/utils";

export type SpotifyGlobalSettings = JsonObject & {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // timestamp in milliseconds
  userId?: string;
  userDisplayName?: string;
  userEmail?: string;
};

export type SpotifyActionSettings = JsonObject & {
  playlistId?: string;
  playlistName?: string;
  showTrackTitleOnKey?: boolean;
};

export interface SpotifyTrack {
  id: string;
  name: string;
  uri: string;
  type: string;
  artists?: Array<{ id: string; name: string }>;
  album?: {
    id: string;
    name: string;
    images?: Array<{ url: string; height: number; width: number }>;
  };
  show?: {
    name: string;
  };
}

export interface SpotifyPlaybackResponse {
  is_playing: boolean;
  item: SpotifyTrack | null;
  currently_playing_type: string;
}

export interface SpotifyPlaylistItem {
  id: string;
  name: string;
  description?: string;
  owner?: {
    id: string;
    display_name: string;
  };
  tracks?: {
    total: number;
  };
  images?: Array<{ url: string; height?: number; width?: number }>;
}

export interface SpotifyPlaylistsResponse {
  items: SpotifyPlaylistItem[];
  next: string | null;
  total: number;
}

export interface SpotifyPlaylistTrackItem {
  track: {
    id: string;
    uri: string;
    name?: string;
  } | null;
}

export interface SpotifyPlaylistTracksResponse {
  items: SpotifyPlaylistTrackItem[];
  next: string | null;
  total: number;
}

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

export interface SpotifyUserResponse {
  id: string;
  display_name: string;
  email?: string;
  images?: Array<{ url: string }>;
}

// Messages from UI to Plugin
export type MessageToPlugin =
  | { event: "getStatus" }
  | { event: "startAuth"; clientId: string; clientSecret: string }
  | { event: "disconnect" }
  | { event: "getPlaylists" }
  | { event: "selectPlaylist"; playlistId: string; playlistName: string };

// Messages from Plugin to UI
export type MessageToPropertyInspector =
  | {
      event: "status";
      connected: boolean;
      userDisplayName?: string;
      clientId?: string;
      playlists?: Array<{ id: string; name: string; total: number }>;
      selectedPlaylistId?: string;
      error?: string;
    }
  | {
      event: "authProgress";
      status: "listening" | "authorizing" | "exchanging" | "success" | "error";
      message: string;
    }
  | {
      event: "playlists";
      playlists: Array<{ id: string; name: string; total: number }>;
    }
  | {
      event: "error";
      message: string;
    };
