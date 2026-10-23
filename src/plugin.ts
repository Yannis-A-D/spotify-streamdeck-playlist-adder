import streamDeck from "@elgato/streamdeck";
import { AddToPlaylistAction } from "./actions/add-to-playlist.js";

// Register action with the Stream Deck SDK
streamDeck.actions.registerAction(new AddToPlaylistAction());

// Establish connection with the Stream Deck application
streamDeck.connect();
