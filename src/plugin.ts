import streamDeck from "@elgato/streamdeck";
import { AddToPlaylistAction } from "./actions/add-to-playlist.js";
import { NextTrackAction } from "./actions/next-track.js";
import { PlayPauseAction } from "./actions/play-pause.js";
import { PreviousTrackAction } from "./actions/previous-track.js";

// Register actions with the Stream Deck SDK
streamDeck.actions.registerAction(new AddToPlaylistAction());
streamDeck.actions.registerAction(new PlayPauseAction());
streamDeck.actions.registerAction(new NextTrackAction());
streamDeck.actions.registerAction(new PreviousTrackAction());

// Establish connection with the Stream Deck application
streamDeck.connect();
