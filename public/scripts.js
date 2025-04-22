let currentInstance = '';
let elapsed = 0;
let duration = 0;
let currentState = 'Stopped';
let lastUpdate = Date.now();
let timer = null;
let browsePath = [];
let baseWebUrl = ''; // Declare a global variable for baseWebUrl
let albumArtCache = {}; // Cache for album art URLs
let isUpdatingQueue = false;
let scrollTimeout = null;
let isProcessingQueue = false;
let isSeekAvailable = false; // Global variable for seek availability
let nowPlayingGuid = null; // Global variable for the current NowPlaying GUID

const albumArtQueue = new Map(); // Use a Map to manage the queue
const processedGuids = new Set();
const volumeSlider = document.getElementById('volumeSlider');

const instanceDropdown = document.getElementById('instance');
const browseButton = document.getElementById('browseButton');

//Commands
const shuffleButton = document.getElementById('shuffleButton');
const thumbsUpButton = document.getElementById('thumbsUpButton');
const thumbsDownButton = document.getElementById('thumbsDownButton');
const repeatButton = document.getElementById('repeatButton');
const skipPrevButton = document.getElementById('skipPrevButton');
const skipNextButton = document.getElementById('skipNextButton');

const clientID = generateUUID(); // Generate a proper UUID
const socket = new WebSocket(`ws://localhost:3000?clientID=${clientID}`);

document.getElementById('progressBar').addEventListener('click', (event) => {
    const progressBar = event.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const newPct = (clickX / rect.width) * 100;
    const seekTime = Math.round((newPct / 100) * duration);

    // Send the Seek command
    const command = {
        type: 'command',
        item: `Seek ${seekTime}`,
        instance: currentInstance,
    };
    console.log(`📤 Sending Seek command: ${seekTime} seconds`);
    socket.send(JSON.stringify(command));

    // Update elapsed time immediately
    elapsed = seekTime;
    updatePlaybackProgress();
});

// Mute Button
const muteButton = document.getElementById('muteButton');
muteButton.onclick = () => {
    const isMuted = muteButton.textContent === '🔇';
    sendCommand(isMuted ? 'Mute Off' : 'Mute On');
    muteButton.textContent = isMuted ? '🔊' : '🔇';
};

function debounce(func, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), delay);
    };
}

// Use debounce for volume slider
volumeSlider.addEventListener('input', debounce(() => {
    const value = volumeSlider.value;
    const percentage = (value / 50) * 100;

    // Update the slider's background
    volumeSlider.style.background = `linear-gradient(to right, green 0%, green ${percentage}%, #ccc ${percentage}%, #ccc 100%)`;

    setVolume(value); // Send the volume command to the server
}, 300));

instanceDropdown.onchange = () => instanceChanged();
browseButton.onclick = () => toggleBrowse();

function toggleButtonState(button, commandOn, commandOff) {
    const isActive = button.classList.contains('active');
    const command = isActive ? commandOff : commandOn;
    sendCommand(command);
    button.classList.toggle('active', !isActive);
    button.classList.toggle('inactive', isActive);
}

// Assign handlers
thumbsUpButton.onclick = () => toggleButtonState(thumbsUpButton, 'ThumbsUp On', 'ThumbsUp Off');
thumbsDownButton.onclick = () => toggleButtonState(thumbsDownButton, 'ThumbsDown On', 'ThumbsDown Off');
shuffleButton.onclick = () => toggleButtonState(shuffleButton, 'Shuffle On', 'Shuffle Off');
repeatButton.onclick = () => toggleButtonState(repeatButton, 'Repeat On', 'Repeat Off');

skipPrevButton.onclick = () => sendCommand('SkipPrevious');
skipNextButton.onclick = () => sendCommand('SkipNext');

const playPauseButton = document.getElementById('playPauseButton');
//playPauseButton.onclick = () => togglePlayPause();

socket.onopen = () => {
    console.log(`🌐 WebSocket connected with clientID: ${clientID}`);
};

socket.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log('📩 Received data:', data);

        switch (data.type) {
            case 'browse':
                renderBrowse(data.items); // Render the browse items
                renderBrowsePath(browsePath); // Update the browse path
                break;

            case 'instances':
                populateInstances(data.instances);
                break;

            case 'keyValue':  //not used in the current code.  changes communicated via stateChanged
                console.log(`❓ Unused key value received: ${data.key} : ${data.value})`);
                break;

            case 'getStatus':
                if (data.instance !== currentInstance) return;

                baseWebUrl = data.data.baseWebUrl || '';

                const {
                    volume = 50,
                    mute = false,
                    trackName = 'Nothing Playing',
                    artistName = 'Unknown Artist',
                    mediaName = 'Unknown Album',
                    nowPlayingGuid: newNowPlayingGuid,
                    trackDuration = 0,
                    trackTime = 0,
                    playState = 'Stopped',
                    trackQueueIndex = 0,
                    totalTracks = 0,
                    thumbsUp = -1,
                    thumbsDown = -1,
                    shuffle = false,
                    repeat = false,
                    seekAvailable = false,
                    playPauseAvailable = true,
                    shuffleAvailable = false,
                    repeatAvailable = false,
                    skipNextAvailable = false,
                    skipPrevAvailable = false,
                } = data.data;

                // Update global nowPlayingGuid
                nowPlayingGuid = newNowPlayingGuid || nowPlayingGuid;

                // Update now-playing UI
                document.getElementById('trackName').textContent = trackName || 'Nothing Playing';
                document.getElementById('artistName').textContent = artistName || 'Unknown Artist';
                document.getElementById('mediaName').textContent = mediaName || 'Unknown Album';
                document.getElementById('queueInfo').textContent = `Track ${trackQueueIndex} of ${totalTracks}`;

                // Update album art
                const albumArt = document.getElementById('albumArt');
                albumArt.src = nowPlayingGuid && baseWebUrl ? `${baseWebUrl}GetArt?guid=${nowPlayingGuid}` : '';
                albumArt.alt = trackName || 'No Album Art';

                elapsed = data.data.trackTime;
                duration = data.data.trackDuration;
                currentState = data.data.playState;
                isSeekAvailable = data.data.seekAvailable;

                lastUpdate = Date.now();

                updateControlButtons(
                    playState,
                    thumbsUp,
                    thumbsDown,
                    repeat,
                    shuffle,
                    playPauseAvailable,
                    shuffleAvailable,
                    repeatAvailable,
                    skipNextAvailable,
                    skipPrevAvailable,
                );
                updatePlaybackProgress();
                updateVolumeFromServer(mute, volume); // Update volume and mute state
                break;

            case 'stateChanged':
                if (data.instance !== currentInstance) return;

                const events = data.events;

                if (!events) return; // Ignore if no events

                // Update thumbs up state
                if (events.ThumbsUp !== undefined) {
                    if (events.ThumbsUp === -1) {
                        thumbsUpButton.classList.add('hidden'); // Hide if unavailable
                    } else {
                        thumbsUpButton.classList.remove('hidden'); // Show if available
                        thumbsUpButton.textContent = '👍'; // Set the thumbs-up icon
                        thumbsUpButton.classList.toggle('inactive', events.ThumbsUp === 0); // Gray out if inactive
                        thumbsUpButton.classList.toggle('active', events.ThumbsUp === 1); // Mark as active if active
                    }
                }

                // Update thumbs down state
                if (events.ThumbsDown !== undefined) {
                    if (events.ThumbsDown === -1) {
                        thumbsDownButton.classList.add('hidden'); // Hide if unavailable
                    } else {
                        thumbsDownButton.classList.remove('hidden'); // Show if available
                        thumbsDownButton.textContent = '👎'; // Set the thumbs-down icon
                        thumbsDownButton.classList.toggle('inactive', events.ThumbsDown === 0); // Gray out if inactive
                        thumbsDownButton.classList.toggle('active', events.ThumbsDown === 1); // Mark as active if active
                    }
                }

                // Update shuffle state
                if (events.ShuffleAvailable !== undefined) {
                    if (!events.ShuffleAvailable) {
                        shuffleButton.classList.add('hidden'); // Hide if unavailable
                    } else {
                        shuffleButton.classList.remove('hidden'); // Show if available
                        shuffleButton.textContent = '🔀'; // Set the shuffle icon
                        shuffleButton.classList.toggle('inactive', !events.Shuffle); // Gray out if inactive
                        shuffleButton.classList.toggle('active', events.Shuffle); // Mark as active if active
                    }
                }

                // Update repeat state
                if (events.RepeatAvailable !== undefined) {
                    if (!events.RepeatAvailable) {
                        repeatButton.classList.add('hidden'); // Hide if unavailable
                    } else {
                        repeatButton.classList.remove('hidden'); // Show if available
                        repeatButton.textContent = '🔁'; // Set the repeat icon
                        repeatButton.classList.toggle('inactive', !events.Repeat); // Gray out if inactive
                        repeatButton.classList.toggle('active', events.Repeat); // Mark as active if active
                    }
                }

                // Update skip previous state
                if (events.SkipPrevAvailable !== undefined) {
                    if (!events.SkipPrevAvailable) {
                        skipPrevButton.classList.add('hidden'); // Hide if unavailable
                    } else {
                        skipPrevButton.classList.remove('hidden'); // Show if available
                        skipPrevButton.textContent = '⏮️'; // Set the skip-previous icon
                    }
                }

                // Update skip next state
                if (events.SkipNextAvailable !== undefined) {
                    if (!events.SkipNextAvailable) {
                        skipNextButton.classList.add('hidden'); // Hide if unavailable
                    } else {
                        skipNextButton.classList.remove('hidden'); // Show if available
                        skipNextButton.textContent = '⏭️'; // Set the skip-next icon
                    }
                }

                // Update play/pause availability
                if (events.PlayPauseAvailable !== undefined) {
                    updatePlayPauseButton(currentState, events.PlayPauseAvailable);
                }

                // Update seek availability
                if (events.SeekAvailable !== undefined) {
                    isSeekAvailable = events.SeekAvailable;
                    document.getElementById('progressBar').disabled = !isSeekAvailable;
                }

                // Update playback progress if TrackTime or TrackDuration is present
                if (events.TrackTime !== undefined) elapsed = parseInt(events.TrackTime, 10);
                if (events.TrackDuration !== undefined) duration = parseInt(events.TrackDuration, 10);

                // Handle MediaArtChanged event
                if (events.MediaArtChanged && nowPlayingGuid) {
                    const albumArt = document.getElementById('albumArt');
                    albumArt.src = `${baseWebUrl}GetArt?guid=${nowPlayingGuid}&timestamp=${Date.now()}`; // Add timestamp to bypass cache
                    console.log(`🔄 Refreshed album art for GUID: ${nowPlayingGuid}`);
                }

                // Handle PlayState event
                if (events.PlayState && events.PlayState !== currentState) {
                    currentState = events.PlayState; // Update the global playback state
                    console.log(`🎵 Playback state updated to: ${currentState}`);
                    updatePlayPauseButton(currentState, events.PlayPauseAvailable);
                }

                // Update now-playing details if TrackQueueIndex or TotalTracks are present
                if (events.TrackQueueIndex || events.TotalTracks) {
                    document.getElementById('queueInfo').textContent = `Track ${events.TrackQueueIndex || 0} of ${events.TotalTracks || 0}`;
                }

                // Update album art if NowPlayingGuid is present
                if (events.NowPlayingGuid) {
                    const albumArt = document.getElementById('albumArt');
                    albumArt.src = `${baseWebUrl}GetArt?guid=${events.NowPlayingGuid}&timestamp=${Date.now()}`; // Add timestamp to bypass cache
                    albumArt.alt = events.TrackName || 'No Album Art';
                    nowPlayingGuid = events.NowPlayingGuid; // Update the global nowPlayingGuid
                }

                // Update other playback information
                if (events.ArtistName) {
                    document.getElementById('artistName').textContent = events.ArtistName; // Ensure ArtistName is updated
                }
                if (events.MediaName) {
                    document.getElementById('mediaName').textContent = events.MediaName; // Ensure MediaName is updated
                }
                if (events.TrackName) {
                    document.getElementById('trackName').textContent = events.TrackName;
                }
                if (events.Mute !== undefined) {
                    muteButton.classList.toggle('active', events.Mute); // Add 'active' class when mute is on
                    muteButton.textContent = events.Mute ? '🔇' : '🔊'; // Update button text
                }
                if (events.Volume) {
                    updateVolumeFromServer(events.Mute, events.Volume); // Update volume and mute state
                }

                lastUpdate = Date.now();

                // Update progress bar and timer
                updatePlaybackProgress();
                break;

            default:
                console.warn(`❓ Unknown data type: ${data.type}`);
                break;
        }
    } catch (err) {
        console.error('❌ Error parsing WebSocket message:', err);
    }
};

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function setupIntersectionObserver() {
    const container = document.getElementById('browseItems');
    const items = container.querySelectorAll('.browse-item');

    // Create an Intersection Observer
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const item = entry.target;
                const img = item.querySelector('img');
                const guid = img ? img.getAttribute('data-guid') : null;

                if (guid && !albumArtCache[guid]) {
                    // Fetch album art for the visible item
                    const albumArtUrl = `${baseWebUrl}GetArt?guid=${guid}`;
                    fetch(albumArtUrl)
                        .then((response) => {
                            if (response.ok) {
                                albumArtCache[guid] = albumArtUrl; // Cache the URL
                                img.src = albumArtUrl; // Update the image source
                                //console.log(`✅ Album art fetched for GUID: ${guid}`);
                            } else {
                                console.error(`❌ Failed to fetch album art for GUID: ${guid}`);
                            }
                        })
                        .catch((error) => {
                            console.error(`❌ Error fetching album art for GUID: ${guid}`, error);
                        });
                }
            }
        });
    }, {
        root: container, // Observe within the scrollable container
        rootMargin: '0px', // No margin around the viewport
        threshold: 0.1, // Trigger when 10% of the item is visible
    });

    // Observe each item
    items.forEach((item) => observer.observe(item));
}

function renderBrowseItems(items) {
    const browseContainer = document.getElementById('browseItems');
    browseContainer.innerHTML = ''; // Clear existing items

    items.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'browse-item';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.marginBottom = '0.5rem';

        // Add album art if available
        if (item.guid) {
            const img = document.createElement('img');
            img.src = `${baseWebUrl}GetArt?guid=${item.guid}`;
            img.alt = item.name || 'Art';
            img.style.width = '50px';
            img.style.height = '50px';
            img.style.objectFit = 'cover';
            img.style.marginRight = '1rem';
            img.style.borderRadius = '4px';
            div.appendChild(img);
        }

        // Add item name
        const span = document.createElement('span');
        span.textContent = item.name || 'Unnamed';
        span.style.flexGrow = '1';
        div.appendChild(span);

        // Add a click handler if the item has children
        if (item.hasChildren) {
            div.style.cursor = 'pointer';
            div.onclick = () => {
                //console.log(`📤 Requesting browse for GUID: ${item.guid}`);
                fetch(`/api/browse?instance=${currentInstance}&guid=${item.guid}&type=${item.type}&clientID=${clientID}`)
                    .then((response) => {
                        if (!response.ok) {
                            console.error(`❌ Failed to browse: ${response.statusText}`);
                        }
                    })
                    .catch((error) => {
                        console.error(`❌ Error browsing:`, error);
                    });
            };
        }

        browseContainer.appendChild(div);
    });

    //console.log('✅ Browse items rendered:', items);
}

function populateInstances(instances) {
    const select = document.getElementById('instance');
    select.innerHTML = '';
    instances.forEach((instance) => {
        const option = document.createElement('option');
        option.value = instance.name; // Use the actual name as the value
        option.textContent = instance.friendlyName || instance.name; // Display the friendly name
        select.appendChild(option);
    });

    // Set the first instance as the default
    currentInstance = select.value;
    //console.log(`✅ Instances populated. Current instance: ${currentInstance}`);
    sendCommand(`SetInstance ${currentInstance}`);
    updateBrowse();
}

function instanceChanged() {
    const select = document.getElementById('instance');
    currentInstance = select.value; // Use the actual name
    //console.log(`🔄 Instance changed to: ${currentInstance}`);
    sendCommand(`SetInstance ${currentInstance}`);
    updateBrowse();
}

function sendCommand(item, instance = currentInstance) {
    if (!instance) {
        alert('Select an instance first.');
        return;
    }

    const message = {
        type: 'command',
        item: item || '',
        instance: instance,
        clientID: clientID,
    };

    console.log(`📤 Sending command via WebSocket:`, message);
    socket.send(JSON.stringify(message));
}

function updateButtonState(button, isAvailable, isActive, icon) {
    if (!isAvailable) {
        button.classList.add('hidden');
    } else {
        button.classList.remove('hidden');
        button.textContent = icon;
        button.classList.toggle('inactive', !isActive);
        button.classList.toggle('active', isActive);
    }
}

// Use the helper function in updateControlButtons
function updateControlButtons(
    playState,
    thumbsUp,
    thumbsDown,
    repeat,
    shuffle,
    playPauseAvailable,
    shuffleAvailable,
    repeatAvailable,
    skipNextAvailable,
    skipPrevAvailable,
) {
    updateButtonState(thumbsUpButton, thumbsUp !== -1, thumbsUp === 1, '👍');
    updateButtonState(thumbsDownButton, thumbsDown !== -1, thumbsDown === 1, '👎');
    updateButtonState(shuffleButton, shuffleAvailable, shuffle, '🔀');
    updateButtonState(repeatButton, repeatAvailable, repeat, '🔁');
    updateButtonState(skipPrevButton, skipPrevAvailable, true, '⏮️');
    updateButtonState(skipNextButton, skipNextAvailable, true, '⏭️');
    updatePlayPauseButton(playState, playPauseAvailable);
}

function updateVolumeFromServer(mute, volume) {
    // Mute Button
    const muteButton = document.getElementById('muteButton');
    muteButton.textContent = mute ? '🔇' : '🔊';

    const percentage = (volume / 50) * 100; // Convert server volume (0-50) to percentage (0-100%)
    volumeSlider.value = volume; // Set the slider's value (0-50)
    volumeSlider.style.background = `linear-gradient(to right, green 0%, green ${percentage}%, #ccc ${percentage}%, #ccc 100%)`;
    console.log(`🔊 Volume updated: ${volume} (${percentage}%)`);
}

function updateProgressBar(elapsed, duration) {
    const progressBar = document.getElementById('progressBar');
    const progressElapsed = document.getElementById('progressElapsed');
    const progressDot = document.getElementById('progressDot');
    const elapsedTimeElement = document.getElementById('elapsedTime');
    const totalTimeElement = document.getElementById('totalTime');

    const pct = duration > 0 ? (elapsed / duration) * 100 : 0;

    // Update progress bar and time display
    progressElapsed.style.width = `${pct}%`;
    progressDot.style.left = `${pct}%`;
    elapsedTimeElement.textContent = formatTime(elapsed);
    totalTimeElement.textContent = formatTime(duration);
}

function updatePlaybackProgress() {
    updatePlaybackProgress = () => {
        clearInterval(timer);

        updateProgressBar(elapsed, duration);

        if (currentState === 'Playing') {
            timer = setInterval(() => {
                const now = Date.now();
                elapsed += Math.floor((now - lastUpdate) / 1000);
                lastUpdate = now;
                updateProgressBar(elapsed, duration);
            }, 1000);
        }
    };
}

function updatePlayPauseButton(playState, playPauseAvailable) {
    const playPauseButton = document.getElementById('playPauseButton');

    if (playState === 'Playing') {
        console.log('🔄 Setting PlayPauseButton to Pause');
        playPauseButton.textContent = '⏸️';
        playPauseButton.onclick = () => {
            console.log('📤 Sending Pause command');
            if (playPauseAvailable) {
                sendCommand('PlayPause'); // Send PlayPause if supported
            } else {
                sendCommand('Pause'); // Send Pause if PlayPause is not supported
            }
        };
    } else {
        console.log('🔄 Setting PlayPauseButton to Play');
        playPauseButton.textContent = '▶️';
        playPauseButton.onclick = () => {
            console.log('📤 Sending Play command');
            if (playPauseAvailable) {
                sendCommand('PlayPause'); // Send PlayPause if supported
            } else {
                sendCommand('Play'); // Send Play if PlayPause is not supported
            }
        };
    }
}

function updatePlaybackUI(data) {
    const progressBar = document.getElementById('progressBar');
    const currentTime = document.getElementById('currentTime');
    const totalTime = document.getElementById('totalTime');

    // Update the progress bar and time display
    if (data.trackDuration > 0) {
        progressBar.max = data.trackDuration;
        progressBar.value = data.trackTime;
        currentTime.textContent = formatTime(data.trackTime);
        totalTime.textContent = formatTime(data.trackDuration);
    } else {
        progressBar.value = 0;
        currentTime.textContent = '0:00';
        totalTime.textContent = '0:00';
    }

    // Enable or disable the progress bar based on SeekAvailable
    progressBar.disabled = !data.seekAvailable;
}

function seekPlayback(value) {
    const seekTime = Math.round((value / 100) * duration); // Convert percentage to seconds
    const command = {
        type: 'command',
        item: `Seek ${seekTime}`, // Send the Seek command with the time in seconds
        instance: currentInstance,
    };
    console.log(`📤 Sending Seek command: ${seekTime} seconds`);
    socket.send(JSON.stringify(command));
}

function updatePlaybackTime(value) {
    const currentTime = document.getElementById('timeInfo');
    const seekTime = Math.round((value / 100) * duration); // Convert percentage to seconds
    const elapsed = formatTime(seekTime);
    const totalDuration = formatTime(duration);
    currentTime.textContent = `${elapsed} / ${totalDuration}`;
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function setVolume(value) {
    // Ensure the volume value is within the range of 0 to 50
    const normalizedValue = Math.max(0, Math.min(50, value));

    const command = {
        type: 'command',
        item: `SetVolume ${normalizedValue}`, // Send the SetVolume command with the normalized volume level
        instance: currentInstance,
    };

    console.log(`📤 Sending SetVolume command: ${normalizedValue}`);
    socket.send(JSON.stringify(command));
}

function toggleMute() {
    const muteButton = document.getElementById('muteButton');
    const isMuted = muteButton.classList.contains('active');
    sendCommand(isMuted ? 'MUTE OFF' : 'MUTE ON'); // Send the appropriate command
}

function updateBrowse() {
    const container = document.getElementById('browseContainer');
    if (container.style.display === 'block') {
        fetchBrowse();
    }
}

window.onload = function () {
    const container = document.getElementById('browseContainer');
    const browseButton = document.getElementById('browseButton');

    // Ensure the Browse button and container are initialized correctly
    if (container && browseButton) {
        container.style.display = 'none'; // Hide the browse container by default
        browseButton.classList.remove('active'); // Set the Browse button to inactive
    }
};

function toggleBrowse() {
    const container = document.getElementById('browseContainer');
    const browseButton = document.getElementById('browseButton');

    // Toggle the visibility of the browse container
    container.style.display = container.style.display === 'none' ? 'block' : 'none';

    // Toggle the active state of the Browse button
    browseButton.classList.toggle('active');

    // Fetch browse data if the container is being shown
    if (container.style.display === 'block') {
        browseStack = [];
        fetchBrowse();
    }
}

function getNormalizedParentType(parent) {
    const typeMap = {
        'BrowseArtists': 'Artist',
        'BrowseGenres': 'Genre',
        'BrowseAlbums': 'Album',
        'BrowseComposers': 'Composer',
        'BrowseNowPlaying': 'Now Playing Queue',
        'BrowseMyMusic': 'My Music',
        'BrowseRecent': 'Recently Tuned',
        'BrowseRadioSources': 'Online',
    };
    return typeMap[parent?.type] || parent?.type;
}

function processAlbumArtQueue() {
    if (isProcessingQueue || albumArtQueue.size === 0) {
        //console.log('ℹ️ No items to process in albumArtQueue. Queue size:', albumArtQueue.size);
        return;
    }

    //console.log('🚀 Triggering processAlbumArtQueue');
    isProcessingQueue = true;

    // Get the first item in the queue
    const [guid, { item, img }] = albumArtQueue.entries().next().value;

    // Remove the item from the queue
    albumArtQueue.delete(guid);

    //console.log(`🌐 Fetching album art for GUID: ${guid}`);

    // Fetch the album art
    const albumArtUrl = `${baseWebUrl}GetArt?guid=${guid}`;
    fetch(albumArtUrl)
        .then((response) => {
            if (response.ok) {
                albumArtCache[guid] = albumArtUrl; // Cache the URL only after successful fetch
                img.src = albumArtUrl; // Update the image source
                //console.log(`✅ Album art fetched for GUID: ${guid}`);
            } else {
                console.error(`❌ Failed to fetch album art for GUID: ${guid}`);
            }
        })
        .catch((error) => {
            console.error(`❌ Error fetching album art for GUID: ${guid}`, error);
        })
        .finally(() => {
            processedGuids.add(guid); // Mark the GUID as processed
            isProcessingQueue = false;
            processAlbumArtQueue(); // Process the next item in the queue
        });
}

function fetchBrowse(guid = null, name = null, item = null, addToPath = true) {
    if (addToPath && guid) {
        // Add the new segment to the path
        browsePath.push({ guid, name, item });
    } else if (!guid) {
        // Reset the path if no GUID is provided
        browsePath = [];
    }

    const message = {
        type: 'browse',
        guid: guid || null,
        name: name || '',
        item: item || '',
        instance: currentInstance,
        clientID: clientID,
    };

    console.log('🌐 Sending browse request via WebSocket:', message);
    socket.send(JSON.stringify(message));

    // Update the browse path UI
    renderBrowsePath(browsePath);
}

function renderBrowse(items) {
    const container = document.getElementById('browseItems');
    container.innerHTML = '';

    if (!Array.isArray(items) || items.length === 0) {
        container.innerHTML = '<p>No items found</p>';
        return;
    }

    // Render all items
    items.forEach((item) => {
        if (!item.guid) {
            console.warn(`⚠️ Missing GUID for item:`, item);
            return; // Skip items without a valid GUID
        }

        const div = document.createElement('div');
        div.className = 'browse-item';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.marginBottom = '0.5rem';

        // Add album art placeholder
        const img = document.createElement('img');
        img.alt = item.name || 'Art';
        img.style.width = '50px';
        img.style.height = '50px';
        img.style.objectFit = 'cover';
        img.style.marginRight = '1rem';
        img.style.borderRadius = '4px';

        // Use artGuid for album art if available, otherwise fallback to guid
        const artGuid = item.artGuid || item.guid;
        img.src = albumArtCache[artGuid] || ''; // Use cached URL if available
        img.setAttribute('data-guid', artGuid); // Add data-guid for identification
        div.appendChild(img);

        // Add item name
        const span = document.createElement('span');
        span.textContent = item.name || 'Unnamed';
        span.style.flexGrow = '1';
        div.appendChild(span);

        div.style.cursor = 'pointer';
        div.onclick = () => {
            // Fetch browse data for the clicked item
            fetchBrowse(item.guid, item.name, item.type);
        };

        container.appendChild(div);
    });

    // Setup the Intersection Observer
    setupIntersectionObserver();
}

function setupIntersectionObserver() {
    const container = document.getElementById('browseItems');
    const items = container.querySelectorAll('.browse-item');

    // Create an Intersection Observer
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const item = entry.target;
                const img = item.querySelector('img');
                const guid = img ? img.getAttribute('data-guid') : null;

                if (guid && !albumArtCache[guid]) {
                    // Fetch album art for the visible item
                    const albumArtUrl = `${baseWebUrl}GetArt?guid=${guid}`;
                    fetch(albumArtUrl)
                        .then((response) => {
                            if (response.ok) {
                                albumArtCache[guid] = albumArtUrl; // Cache the URL
                                img.src = albumArtUrl; // Update the image source
                            } else {
                                console.error(`❌ Failed to fetch album art for GUID: ${guid}`);
                            }
                        })
                        .catch((error) => {
                            console.error(`❌ Error fetching album art for GUID: ${guid}`, error);
                        });
                }
            }
        });
    }, {
        root: container, // Observe within the scrollable container
        rootMargin: '0px', // No margin around the viewport
        threshold: 0.1, // Trigger when 10% of the item is visible
    });

    // Observe each item
    items.forEach((item) => observer.observe(item));
}

function renderBrowsePath(path) {
    const pathContainer = document.getElementById('browsePath');
    pathContainer.innerHTML = ''; // Clear the existing path

    // Always include "Home" as the root
    const homeSpan = document.createElement('span');
    homeSpan.className = 'path-segment';
    homeSpan.textContent = 'Home';
    homeSpan.onclick = () => {
        browsePath = []; // Reset the path to the top level
        fetchBrowse(null, '', '', false); // Fetch the top-level items
    };
    pathContainer.appendChild(homeSpan);

    if (Array.isArray(path) && path.length > 0) {
        // Add a separator after "Home"
        const separator = document.createElement('span');
        separator.textContent = ' > ';
        pathContainer.appendChild(separator);

        // Render each segment of the path
        path.forEach((segment, index) => {
            const span = document.createElement('span');
            span.className = 'path-segment';
            span.textContent = segment.name;
            span.onclick = () => {
                // Slice the browsePath up to the clicked level
                browsePath = browsePath.slice(0, index + 1);

                // Fetch the items for the clicked level
                fetchBrowse(segment.guid, segment.name, segment.item, false); // Do not re-add to path
            };
            pathContainer.appendChild(span);

            // Add a separator if this is not the last segment
            if (index < path.length - 1) {
                const separator = document.createElement('span');
                separator.textContent = ' > ';
                pathContainer.appendChild(separator);
            }
        });
    }
}