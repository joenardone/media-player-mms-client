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
let seekAvailable = false; // Global variable for seek availability
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

volumeSlider.addEventListener('input', () => {
    const value = volumeSlider.value; // Get the current volume value (0-50)
    const percentage = (value / 50) * 100; // Convert to percentage

    // Update the slider's background
    volumeSlider.style.background = `linear-gradient(to right, green 0%, green ${percentage}%, #ccc ${percentage}%, #ccc 100%)`;

    // Optionally, send the volume value to the server
    setVolume(value);
});

instanceDropdown.onchange = () => instanceChanged();
browseButton.onclick = () => toggleBrowse();

thumbsUpButton.onclick = () => {
    const isActive = thumbsUpButton.classList.contains('active');
    const command = isActive ? 'ThumbsUp Off' : 'ThumbsUp On';
    sendCommand(command);
    thumbsUpButton.classList.toggle('active', !isActive);
    thumbsUpButton.classList.toggle('inactive', isActive);
};

thumbsDownButton.onclick = () => {
    const isActive = thumbsDownButton.classList.contains('active');
    const command = isActive ? 'ThumbsDown Off' : 'ThumbsDown On';
    sendCommand(command);
    thumbsDownButton.classList.toggle('active', !isActive);
    thumbsDownButton.classList.toggle('inactive', isActive);
};

shuffleButton.onclick = () => {
    const isActive = shuffleButton.classList.contains('active');
    const command = isActive ? 'Shuffle Off' : 'Shuffle On';
    sendCommand(command);
    shuffleButton.classList.toggle('active', !isActive);
    shuffleButton.classList.toggle('inactive', isActive);
};

repeatButton.onclick = () => {
    const isActive = repeatButton.classList.contains('active');
    const command = isActive ? 'Repeat Off' : 'Repeat On';
    sendCommand(command);
    repeatButton.classList.toggle('active', !isActive);
    repeatButton.classList.toggle('inactive', isActive);
};

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
                renderBrowse(data.items);
                updateBrowsePath();
                break;

            case 'instances':
                populateInstances(data.instances);
                break;

            case 'keyValue':
                if (data.key === 'Instance') {
                    currentInstance = data.value.replace(/"/g, '');
                } else if (data.key === 'TopMenu' && data.value === 'Ok') {
                    browsePath = [];
                    updateBrowsePath();
                    console.log(`🔄 Browse path set to Top menu`);
                }
                break;

            case 'getStatus':
                if (data.instance !== currentInstance) return;

                baseWebUrl = data.data.baseWebUrl || '';

                const {
                    trackName,
                    artistName,
                    mediaName,
                    nowPlayingGuid: newNowPlayingGuid,
                    trackDuration,
                    trackTime,
                    playState,
                    trackQueueIndex,
                    totalTracks,
                    shuffle = false,
                    repeat = false,
                    thumbsUp = false,
                    thumbsDown = false,
                    volume = 50,
                    mute = false,
                    thumbsUpAvailable = false,
                    thumbsDownAvailable = false,
                    shuffleAvailable = false,
                    repeatAvailable = false,
                    skipNextAvailable = false,
                    skipPrevAvailable = false,
                    playPauseAvailable = false,
                    seekAvailable: isSeekAvailable = false,
                } = data.data;

                // Update global nowPlayingGuid
                nowPlayingGuid = newNowPlayingGuid || nowPlayingGuid;

                // Update now-playing UI
                document.getElementById('trackName').textContent = trackName || 'Nothing playing';
                document.getElementById('artistName').textContent = artistName || 'Unknown Artist';
                document.getElementById('mediaName').textContent = mediaName || 'Unknown Album';
                document.getElementById('queueInfo').textContent = `Track ${trackQueueIndex} of ${totalTracks}`;

                // Update album art
                const albumArt = document.getElementById('albumArt');
                albumArt.src = nowPlayingGuid && baseWebUrl ? `${baseWebUrl}GetArt?guid=${nowPlayingGuid}` : '';
                albumArt.alt = trackName || 'No Album Art';

                // Update other UI state
                seekAvailable = data.data.seekAvailable || false;
                elapsed = data.data.trackTime || 0;
                duration = data.data.trackDuration || 0;
                currentState = data.data.playState || 'Stopped';
                lastUpdate = Date.now();

                updatePlaybackProgress();
                updateControlButtons({
                    thumbsUp,
                    thumbsDown,
                    repeat,
                    shuffle,
                    shuffleAvailable,
                    repeatAvailable,
                    skipNextAvailable,
                    skipPrevAvailable,
                    playState,
                });
                updatePlayPauseButton(playState, playPauseAvailable);
                updateVolumeFromServer(mute, volume); // Update volume and mute state
                break;

            case 'stateChanged':
                if (data.instance !== currentInstance) return;

                const events = data.events;

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
                    document.getElementById('queueInfo').textContent = `Track ${events.TrackQueueIndex || 0} of ${events.TotalTracks || 0}'}`;
                }

                // Update album art if NowPlayingGuid is present
                if (events.NowPlayingGuid) {
                    const albumArt = document.getElementById('albumArt');
                    albumArt.src = `${baseWebUrl}GetArt?guid=${events.NowPlayingGuid}&timestamp=${Date.now()}`; // Add timestamp to bypass cache
                    albumArt.alt = events.TrackName || 'No Album Art';
                    nowPlayingGuid = events.NowPlayingGuid; // Update the global nowPlayingGuid
                }

                // Update other playback information
                if (events.TrackTime) elapsed = parseInt(events.TrackTime, 10);
                if (events.TrackDuration) duration = parseInt(events.TrackDuration, 10);
                if (events.PlayState) currentState = events.PlayState;

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
                    const muteButton = document.getElementById('muteButton');
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

function sendCommand(item) {
    if (!currentInstance) {
        alert('Select an instance first.');
        return;
    }

    const message = {
        type: 'command',
        item: item || '',
        instance: currentInstance,
        clientID: clientID,
    };

    console.log(`📤 Sending command via WebSocket:`, message);
    socket.send(JSON.stringify(message));
}

function updateControlButtons({
    thumbsUp,
    thumbsDown,
    repeat,
    shuffle,
    shuffleAvailable,
    repeatAvailable,
    skipNextAvailable,
    skipPrevAvailable,
    playState,
}) {
    // Thumbs Up Button
    thumbsUpButton.textContent = thumbsUp === 1 ? '👍' : '👍🏻'; // Filled for active, outline for inactive
    thumbsUpButton.style.color = thumbsUp === -1 ? '#ccc' : thumbsUp === 1 ? 'green' : 'gray'; // Gray for inactive, green for active, light gray for unavailable
    thumbsUpButton.classList.toggle('disabled', thumbsUp === -1); // Disabled if not available

    // Thumbs Down Button
    thumbsDownButton.textContent = thumbsDown === 1 ? '👎' : '👎🏻'; // Filled for active, outline for inactive
    thumbsDownButton.style.color = thumbsDown === -1 ? '#ccc' : thumbsDown === 1 ? 'red' : 'gray'; // Gray for inactive, red for active, light gray for unavailable
    thumbsDownButton.classList.toggle('disabled', thumbsDown === -1); // Disabled if not available

    // Shuffle Button
    shuffleButton.textContent = shuffle ? '🔀 x' : '🔀'; // Add 'x' when active
    shuffleButton.classList.toggle('active', shuffle);
    shuffleButton.classList.toggle('inactive', !shuffle);
    shuffleButton.classList.toggle('disabled', !shuffleAvailable);

    // Repeat Button
    repeatButton.textContent = repeat ? '🔁 x' : '🔁'; // Add 'x' when active
    repeatButton.classList.toggle('active', repeat);
    repeatButton.classList.toggle('inactive', !repeat);
    repeatButton.classList.toggle('disabled', !repeatAvailable);

    // Skip Previous Button
    skipPrevButton.textContent = '⏮️';
    skipPrevButton.classList.toggle('disabled', !skipPrevAvailable);

    // Play/Pause Button
    playPauseButton.textContent = playState === 'Playing' ? '⏸️' : '▶️';

    // Skip Next Button
    skipNextButton.textContent = '⏭️';
    skipNextButton.classList.toggle('disabled', !skipNextAvailable);
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

function updatePlaybackProgress() {
    clearInterval(timer);

    const progressBar = document.getElementById('progressBar');
    const progressElapsed = document.getElementById('progressElapsed');
    const progressDot = document.getElementById('progressDot');
    const elapsedTimeElement = document.getElementById('elapsedTime');
    const totalTimeElement = document.getElementById('totalTime');

    // Calculate progress percentage
    const pct = duration > 0 ? (elapsed / duration) * 100 : 0;

    // Update elapsed bar width and dot position
    progressElapsed.style.width = `${pct}%`;
    progressDot.style.left = `${pct}%`;

    // Update elapsed and total time display
    elapsedTimeElement.textContent = formatTime(elapsed);
    totalTimeElement.textContent = formatTime(duration);

    // Enable or disable the progress bar based on global seekAvailable
    progressBar.disabled = !seekAvailable;

    // Start the timer if the playback is in the "Playing" state
    if (currentState === 'Playing') {
        timer = setInterval(() => {
            const now = Date.now();
            elapsed += Math.floor((now - lastUpdate) / 1000);
            lastUpdate = now;

            const pct = duration > 0 ? (elapsed / duration) * 100 : 0;
            progressElapsed.style.width = `${pct}%`;
            progressDot.style.left = `${pct}%`;
            elapsedTimeElement.textContent = formatTime(elapsed);
            totalTimeElement.textContent = formatTime(duration);
        }, 1000);
    }
}

/*
function togglePlayPause() {
    const playPauseButton = document.getElementById('playPauseButton');
    const isPlaying = playPauseButton.textContent === '⏸️'; // Check if the current state is "Playing"

    console.log(`📤 Sending ${isPlaying ? 'Pause' : 'Play'} command`);
    sendCommand(isPlaying ? 'Pause' : 'Play'); // Send the appropriate command

    // Update the button text and state
    playPauseButton.textContent = isPlaying ? '▶️' : '⏸️';
}
*/

function updatePlayPauseButton(playState, playPauseAvailable) {
    const playPauseButton = document.getElementById('playPauseButton');

    // Always show the Play/Pause button
    playPauseButton.style.display = 'inline-block';

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

function fetchBrowse(guid = null, name = null, item = null, addToPath = true) {
    if (addToPath && guid) {
        browsePath.push({ guid, name, item });
    } else if (!guid) {
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

function renderBrowse(items) {
    const container = document.getElementById('browseItems');
    container.innerHTML = '';

    if (!Array.isArray(items) || items.length === 0) {
        container.innerHTML = '<p>No items found</p>';
        return;
    }

    //console.log('✅ Browse items rendered:', items);

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
        img.src = albumArtCache[item.guid] || ''; // Use cached URL if available
        img.setAttribute('data-guid', item.guid); // Add data-guid for identification
        div.appendChild(img);

        // Add item name
        const span = document.createElement('span');
        span.textContent = item.name || 'Unnamed';
        span.style.flexGrow = '1';
        div.appendChild(span);

        div.style.cursor = 'pointer';
        div.onclick = () => {
            //console.log('🧭 Clicked:', item);
            fetchBrowse(item.guid, item.name, item.type);
        };

        container.appendChild(div);
    });

    // Setup the Intersection Observer
    setupIntersectionObserver();
}

function updateBrowsePath() {
    const pathContainer = document.getElementById('browsePath');
    pathContainer.innerHTML = '<span class="path-segment" onclick="fetchBrowse(null, \'\', \'\', false)">Home</span>';

    browsePath.forEach((item, index) => {
        const span = document.createElement('span');
        span.className = 'path-segment';
        span.textContent = item.name;
        span.onclick = () => {
            // Slice the browsePath up to the clicked level
            browsePath = browsePath.slice(0, index + 1);

            // Fetch the items for the clicked level
            fetchBrowse(item.guid, item.name, item.type, false); // Do not re-add to path
        };
        pathContainer.appendChild(span);
    });
}
