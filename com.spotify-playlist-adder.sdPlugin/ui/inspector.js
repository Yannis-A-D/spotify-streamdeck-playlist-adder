let websocket = null;
let pluginUUID = null;
let actionInfo = null;
let currentSettings = {};

// DOM Elements
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const disconnectBtn = document.getElementById("disconnectBtn");
const setupCard = document.getElementById("setupCard");
const playlistCard = document.getElementById("playlistCard");
const clientIdInput = document.getElementById("clientIdInput");
const clientSecretInput = document.getElementById("clientSecretInput");
const connectBtn = document.getElementById("connectBtn");
const connectBtnSpinner = document.getElementById("connectBtnSpinner");
const connectBtnText = document.getElementById("connectBtnText");
const authStatusMessage = document.getElementById("authStatusMessage");
const playlistSelect = document.getElementById("playlistSelect");
const refreshPlaylistsBtn = document.getElementById("refreshPlaylistsBtn");
const showTrackTitleCheckbox = document.getElementById("showTrackTitleCheckbox");
const showAlbumArtCheckbox = document.getElementById("showAlbumArtCheckbox");

/**
 * Standard Elgato Property Inspector WebSocket initialization entrypoint.
 */
window.connectElgatoStreamDeckSocket = function (
  inPort,
  inPluginUUID,
  inRegisterEvent,
  inInfo,
  inActionInfo
) {
  pluginUUID = inPluginUUID;
  actionInfo = JSON.parse(inActionInfo);
  currentSettings = actionInfo.payload.settings || {};

  // Initialize UI with action settings
  if (currentSettings.showTrackTitleOnKey !== undefined) {
    showTrackTitleCheckbox.checked = currentSettings.showTrackTitleOnKey;
  }
  if (currentSettings.showAlbumArt !== undefined && showAlbumArtCheckbox) {
    showAlbumArtCheckbox.checked = currentSettings.showAlbumArt;
  }

  // Connect to Stream Deck WebSocket
  websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);

  websocket.onopen = function () {
    // Register Property Inspector with Stream Deck
    const registerJson = {
      event: inRegisterEvent,
      uuid: inPluginUUID
    };
    websocket.send(JSON.stringify(registerJson));

    // Request current auth & playlist status from plugin
    sendToPlugin({ event: "getStatus" });
  };

  websocket.onmessage = function (evt) {
    try {
      const data = JSON.parse(evt.data);
      if (data.event === "sendToPropertyInspector") {
        handlePluginMessage(data.payload);
      } else if (data.event === "didReceiveSettings") {
        currentSettings = data.payload.settings || {};
        if (currentSettings.showTrackTitleOnKey !== undefined) {
          showTrackTitleCheckbox.checked = currentSettings.showTrackTitleOnKey;
        }
        if (currentSettings.showAlbumArt !== undefined && showAlbumArtCheckbox) {
          showAlbumArtCheckbox.checked = currentSettings.showAlbumArt;
        }
        if (currentSettings.playlistId && playlistSelect) {
          playlistSelect.value = currentSettings.playlistId;
        }
      }
    } catch (e) {
      console.error("Error processing message:", e);
    }
  };
};

/**
 * Sends a message payload to the backend plugin.
 */
function sendToPlugin(payload) {
  if (websocket && websocket.readyState === WebSocket.OPEN && actionInfo) {
    const json = {
      event: "sendToPlugin",
      action: actionInfo.action,
      context: pluginUUID,
      payload: payload
    };
    websocket.send(JSON.stringify(json));
  }
}

/**
 * Updates action instance settings in Stream Deck.
 */
function saveActionSettings(newSettings) {
  currentSettings = { ...currentSettings, ...newSettings };
  if (websocket && websocket.readyState === WebSocket.OPEN && actionInfo) {
    const json = {
      event: "setSettings",
      context: pluginUUID,
      payload: currentSettings
    };
    websocket.send(JSON.stringify(json));
  }
}

/**
 * Handles incoming payloads from the plugin backend.
 */
function handlePluginMessage(payload) {
  if (!payload || !payload.event) return;

  switch (payload.event) {
    case "status":
      updateConnectionState(payload);
      break;

    case "authProgress":
      handleAuthProgress(payload);
      break;

    case "playlists":
      populatePlaylists(payload.playlists, currentSettings.playlistId);
      break;

    case "error":
      authStatusMessage.textContent = payload.message;
      authStatusMessage.style.color = "#ff6b77";
      setConnecting(false);
      break;
  }
}

function updateConnectionState(data) {
  setConnecting(false);

  if (data.clientId && !clientIdInput.value) {
    clientIdInput.value = data.clientId;
  }

  if (data.connected) {
    // Show connected status
    statusBadge.className = "status-badge connected";
    statusText.textContent = data.userDisplayName
      ? `Connected as ${data.userDisplayName}`
      : "Connected";
    disconnectBtn.classList.remove("hidden");
    setupCard.classList.add("hidden");
    playlistCard.classList.remove("hidden");

    if (data.playlists && data.playlists.length > 0) {
      populatePlaylists(data.playlists, data.selectedPlaylistId || currentSettings.playlistId);
    }
  } else {
    // Show disconnected status
    statusBadge.className = "status-badge disconnected";
    statusText.textContent = "Not connected";
    disconnectBtn.classList.add("hidden");
    setupCard.classList.remove("hidden");
    playlistCard.classList.add("hidden");
  }
}

function handleAuthProgress(data) {
  switch (data.status) {
    case "listening":
      setConnecting(true, "Browser opened. Log in to Spotify...");
      break;
    case "exchanging":
      setConnecting(true, "Exchanging authorization tokens...");
      break;
    case "success":
      authStatusMessage.textContent = data.message;
      authStatusMessage.style.color = "#1DB954";
      setConnecting(false);
      break;
    case "error":
      authStatusMessage.textContent = data.message;
      authStatusMessage.style.color = "#ff6b77";
      setConnecting(false);
      break;
  }
}

function populatePlaylists(playlists, selectedId) {
  playlistSelect.innerHTML = '<option value="">-- Choose a playlist --</option>';

  // Always add Liked Songs as top choice
  const likedOpt = document.createElement("option");
  likedOpt.value = "__liked_songs__";
  likedOpt.textContent = "💚 Liked Songs (Lieblingssongs)";
  if (selectedId === "__liked_songs__") {
    likedOpt.selected = true;
  }
  playlistSelect.appendChild(likedOpt);

  if (playlists && playlists.length > 0) {
    for (const pl of playlists) {
      const opt = document.createElement("option");
      opt.value = pl.id;
      opt.textContent = `${pl.name} (${pl.total} tracks)`;
      if (selectedId && pl.id === selectedId) {
        opt.selected = true;
      }
      playlistSelect.appendChild(opt);
    }
  }
}

function setConnecting(loading, message = "") {
  if (loading) {
    connectBtn.disabled = true;
    connectBtnSpinner.classList.remove("hidden");
    connectBtnText.textContent = "Connecting...";
    authStatusMessage.textContent = message;
    authStatusMessage.style.color = "#a0a0a0";
  } else {
    connectBtn.disabled = false;
    connectBtnSpinner.classList.add("hidden");
    connectBtnText.textContent = "Connect Spotify";
  }
}

// Event Listeners
connectBtn.addEventListener("click", () => {
  const clientId = clientIdInput.value.trim();
  const clientSecret = clientSecretInput.value.trim();

  if (!clientId || !clientSecret) {
    authStatusMessage.textContent = "Please enter both Client ID and Client Secret.";
    authStatusMessage.style.color = "#ff6b77";
    return;
  }

  authStatusMessage.textContent = "";
  setConnecting(true, "Starting authentication...");
  sendToPlugin({
    event: "startAuth",
    clientId: clientId,
    clientSecret: clientSecret
  });
});

disconnectBtn.addEventListener("click", () => {
  if (confirm("Are you sure you want to disconnect Spotify?")) {
    sendToPlugin({ event: "disconnect" });
  }
});

refreshPlaylistsBtn.addEventListener("click", () => {
  refreshPlaylistsBtn.textContent = "...";
  sendToPlugin({ event: "getPlaylists" });
  setTimeout(() => {
    refreshPlaylistsBtn.textContent = "Refresh";
  }, 1000);
});

playlistSelect.addEventListener("change", () => {
  const playlistId = playlistSelect.value;
  let playlistName = "";
  if (playlistId === "__liked_songs__") {
    playlistName = "Liked Songs";
  } else if (playlistId) {
    const selectedOption = playlistSelect.options[playlistSelect.selectedIndex];
    playlistName = selectedOption ? selectedOption.text.replace(/\s\(\d+\stracks\)$/, "") : "";
  }

  saveActionSettings({
    playlistId: playlistId,
    playlistName: playlistName
  });

  sendToPlugin({
    event: "selectPlaylist",
    playlistId: playlistId,
    playlistName: playlistName
  });
});

showTrackTitleCheckbox.addEventListener("change", () => {
  saveActionSettings({
    showTrackTitleOnKey: showTrackTitleCheckbox.checked
  });
});

showAlbumArtCheckbox.addEventListener("change", () => {
  saveActionSettings({
    showAlbumArt: showAlbumArtCheckbox.checked
  });
});
