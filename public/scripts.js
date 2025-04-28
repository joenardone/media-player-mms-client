const CONFIG = {
    BASE_IP: "192.168.162.64",
    POLL_TIME: 5000, // 5 seconds
};

let isPolling = false;
let currentInstance;
let guid;

let playState = false
let mediaControl = 0; // Media control state
let volume = 50;   // Default volume 0-50.  50 is 100% Gain
let mute = false;

let thumbsUp = false;
let thumbsDown = false;
let shuffletAvailable = false;
let shuffle = false;
let repeatAvailable = false;
let repeat = false;

let playPauseAvailable = true;
let thumbsUpAvailable = false;
let thumbsDownAvailable = false;
let skipPrevAvailable = false;
let skipNextAvailable = false;

let isTuneBridgeActive = false;

let elapsed = 0;
let duration = 0;
let lastUpdate = Date.now();
let timer = null;
let browsePath = [];
let albumArtCache = {}; // Cache for album art URLs
let albumGuid = null; // Store the album GUID
let isUpdatingQueue = false;
let scrollTimeout = null;
let isProcessingQueue = false;

const instanceElement = document.getElementById('instance');

const browseButton = document.getElementById('browseButton');
const browseContainerElement = document.getElementById('browseContainer');
const browsePathElement = document.getElementById('browsePath');
const browseItemsElement = document.getElementById('browseItems');

const albumArtQueue = new Map(); // Use a Map to manage the queue
const processedGuids = new Set();
const volumeSlider = document.getElementById('volumeSlider');
const muteButton = document.getElementById('muteButton');

const playPauseButton = document.getElementById('playPauseButton');

const progressBar = document.getElementById('progressBar');
const progressElapsed = document.getElementById('progressElapsed');
const progressDot = document.getElementById('progressDot');
const elapsedTimeElement = document.getElementById('elapsedTime');
const totalTimeElement = document.getElementById('totalTime');
const currentTime = document.getElementById('timeInfo');

const thumbsUpButton = document.getElementById('thumbsUpButton');
const thumbsDownButton = document.getElementById('thumbsDownButton');
const shuffleButton = document.getElementById('shuffleButton');
const repeatButton = document.getElementById('repeatButton');
const skipPrevButton = document.getElementById('skipPrevButton');
const skipNextButton = document.getElementById('skipNextButton');

const titleElement = document.getElementById('title');
const artistElement = document.getElementById('artist');
const albumElement = document.getElementById('album');
const genreElement = document.getElementById('genre');

const metaData1Element = document.getElementById('metaData1');
const metaData2Element = document.getElementById('metaData2');
const metaData3Element = document.getElementById('metaData3');
const metaData4Element = document.getElementById('metaData4');
const nowPlayingSrceNameElement = document.getElementById('nowPlayingSrceName');

const albumArtElement = document.getElementById('albumArt');

document.getElementById('progressBar').addEventListener('click', (event) => {
    const progressBar = event.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const newPct = (clickX / rect.width) * 100;
    const seekTime = Math.round((newPct / 100) * duration); // Convert percentage to seconds

    // Send the Seek command
    const command = {
        type: 'command',
        item: `Seek ${seekTime}`,
        instance: currentInstance,
    };
    //console.log(`📤 Sending Seek command: ${seekTime} seconds`);
    sendCommand(`Seek ${seekTime}`);

    // Update trackTime time immediately
    trackTime = seekTime;
    updatePlaybackProgress();
});


// Assign handlers
browseButton.onclick = () => toggleBrowse();
instanceElement.onchange = () => instanceChanged();

playPauseButton.onclick = () => togglePlayPauseButton();
muteButton.onclick = () => {
    const isMuted = muteButton.textContent === '🔇';
    sendCommand(isMuted ? 'Mute Off' : 'Mute On');
    //updated through feedback from server, redundant here, but can be used for immediate feedback
    muteButton.textContent = isMuted ? '🔊' : '🔇';
};

thumbsUpButton.onclick = () => toggleButtonState(thumbsUpButton, 'ThumbsUp On', 'ThumbsUp Off');
thumbsDownButton.onclick = () => toggleButtonState(thumbsDownButton, 'ThumbsDown On', 'ThumbsDown Off');
shuffleButton.onclick = () => toggleButtonState(shuffleButton, 'Shuffle On', 'Shuffle Off');
repeatButton.onclick = () => toggleButtonState(repeatButton, 'Repeat On', 'Repeat Off');

skipPrevButton.onclick = () => sendCommand('SkipPrevious');
skipNextButton.onclick = () => sendCommand('SkipNext');


const clientID = generateUUID(); // Generate a proper UUID
//const socket = new WebSocket(`ws://localhost:3000?clientID=${clientID}`);

let baseUrl = `http://${CONFIG.BASE_IP}`;

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// Always poll after sending commands, unless suppressed
async function sendCommand(commands, pollAfter = true) {
    if (!Array.isArray(commands)) commands = [commands];
    const encoded = commands.map(cmd => encodeURIComponent(cmd));
    const url = `${baseUrl}/api/Script/${encoded.join('/')}` +
        `?clientId=${clientID}`;
    await fetch(url, { method: 'GET' });
    if (pollAfter) {
        await pollMmsStatus();
    }
}

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


function toggleButtonState(button, commandOn, commandOff) {
    const isActive = button.classList.contains('active');
    const command = isActive ? commandOff : commandOn;
    sendCommand(command);
    button.classList.toggle('active', !isActive);
    button.classList.toggle('inactive', isActive);
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

function setVolume(value) {
    const normalizedValue = Math.max(0, Math.min(50, value));
    sendCommand(`SetVolume ${normalizedValue}`);
}

function togglePlayPauseButton() {
    let commandOn, commandOff;
    if (playPauseAvailable = true) {
        commandOn = 'PlayPause';
        commandOff = 'PlayPause';
    }
    else {
        commandOn = 'Play';
        commandOff = 'Pause';
    }
    const command = playState ? commandOff : commandOn;
    sendCommand(command);
    // button state updated from feedback from server
}

function toggleMute() {
    const isMuted = muteButton.classList.contains('active');
    sendCommand(isMuted ? 'MUTE OFF' : 'MUTE ON'); // Send the appropriate command
}

function toggleBrowse() {
    isTuneBridgeActive = false;
    tuneBridgeButton.classList.remove('active');

    // Toggle the visibility of the browse container
    if (browseContainerElement.style.display === 'none') {
        browseContainerElement.style.display = 'block'; // Show
    } else {
        browseContainerElement.style.display = 'none';  // Hide
    }

    // Toggle the active state of the Browse button
    browseButton.classList.toggle('active');

    // Fetch browse data if the container is being shown
    if (browseContainerElement.style.display === 'block') {
        fetchBrowse();
    }
}

const tuneBridgeButton = document.getElementById('tuneBridgeButton');
if (tuneBridgeButton) {
    tuneBridgeButton.onclick = async () => {
        const container = document.getElementById('browseContainer');
        const isVisible = container.style.display === 'block';
        // Check if TuneBridge is the current view
        const isTuneBridgeView = isVisible &&
            browsePath.length === 1 &&
            browsePath[0].type === 'TuneBridge';

        if (isTuneBridgeView) {
            // Close the window and deactivate
            container.style.display = 'none';
            browseButton.classList.remove('active');
            isTuneBridgeActive = false;
        } else {
            // Activate TuneBridge and show the window
            container.style.display = 'block';
            browseButton.classList.add('active');
            isTuneBridgeActive = true;
            await sendCommand('AckButton CONTEXT');
        }
    };
}

async function populateInstances(items) {
    if (!Array.isArray(items)) {
        console.error('❌ Invalid instances data:', items);
        return;
    }

    const select = instanceElement;
    select.innerHTML = ''; // Clear existing options

    items.forEach((item) => {
        const option = document.createElement('option');
        // Use Value as the value, FriendlyName as the label, fallback to Value if FriendlyName is missing
        option.value = item.value || '';
        option.textContent = item.friendlyName || item.value || 'Unnamed';
        select.appendChild(option);
    });

    // Set the first instance as the default
    currentInstance = select.value;
    //console.log(`✅ Instances populated. Current instance: ${currentInstance}`);
    const commands = [
        'SetInstance ' + currentInstance,
        'GetStatus',
        'SubscribeEvents',
    ]
    await sendCommand(commands);
}

async function instanceChanged() {
    const select = instanceElement;
    currentInstance = select.value; // Use the actual name
    // Hide the browse window and deactivate the button
    browseContainerElement.style.display = 'none';
    browseButton.classList.remove('active');
    const commands = [
        'SetInstance ' + currentInstance,
        'GetStatus',
        'SubscribeEvents',
    ]
    await sendCommand(commands);
}

function updateNowPlayingHeader(sourceName, albumName) {
    const artImg = document.getElementById('nowPlayingSourceArt');
    const srcNameElem = document.getElementById('nowPlayingSrceName');
    const albumElem = document.getElementById('nowPlayingAlbum');
    srcNameElem.textContent = sourceName || '';
    albumElem.textContent = albumName ? `• ${albumName}` : '';

    // Map source name to image file
    const imageMap = {
        "SiriusXM Internet Radio": "siriusXM-50x50.png",
        "Spotify": "spotify-50x50.png",
        "Pandora Internet Radio": "pandora-50x50.png"
        // Add more mappings as needed
    };
    const imgFile = imageMap[sourceName];

    if (imgFile) {
        artImg.src = `images/${imgFile}`; // <-- No leading slash!
        artImg.style.display = '';
    } else {
        artImg.src = `images/music-note.svg`; // Default image
        artImg.style.display = '';
    }
}

function updateProgressBar() {
    const pct = duration > 0 ? (elapsed / duration) * 100 : 0;
    progressElapsed.style.width = `${pct}%`;
    progressDot.style.left = `${pct}%`;
    elapsedTimeElement.textContent = formatTime(Math.floor(elapsed));
    totalTimeElement.textContent = formatTime(Math.floor(duration));
}

function updatePlaybackProgress() {
    // Always clear any previous timer
    if (timer) clearInterval(timer);

    // Draw the current state immediately
    updateProgressBar();

    // Only start timer if playing AND elapsed > 0
    if (playState && elapsed > 0) {
        let lastTick = Date.now();
        timer = setInterval(() => {
            const now = Date.now();
            // Increment elapsed by the number of seconds since last tick
            elapsed += (now - lastTick) / 1000;
            lastTick = now;
            // Clamp elapsed to duration
            if (elapsed > duration) elapsed = duration;
            updateProgressBar();
        }, 1000 / 4); // update 4 times per second for smoothness
    }
}

function updatePlayPauseButton() {
    if (playState) {   //Stopped = 0, Play = 1, Pause = 2, Streaming = 3';
        //console.log('🔄 Setting PlayPauseButton to Pause');

        playPauseButton.textContent = '⏸️';
        //console.log('Set icon to:', playPauseButton.textContent);

        playPauseButton.onclick = () => {
            if (playPauseAvailable) {
                sendCommand('PlayPause'); // Send PlayPause if supported
            } else {
                sendCommand('Pause'); // Send Pause if PlayPause is not supported
            }
        };
    } else {
       //console.log('🔄 Setting PlayPauseButton to Play');

        playPauseButton.textContent = '▶️';
        //console.log('Set icon to:', playPauseButton.textContent);

        playPauseButton.onclick = () => {
            if (playPauseAvailable) {
                sendCommand('PlayPause'); // Send PlayPause if supported
            } else {
                sendCommand('Play'); // Send Play if PlayPause is not supported
            }
        };
    }

}

function seekPlayback(value) {
    const seekTime = Math.round((value / 100) * duration); // Convert percentage to seconds
    //console.log(`📤 Sending Seek command: ${seekTime} seconds`);
    sendCommand(`Seek ${seekTime}`);
}

function updatePlaybackTime(value) {

    const seekTime = Math.round((value / 100) * duration); // Convert percentage to seconds
    const elapsed = formatTime(seekTime);
    const duration = formatTime(trrackDuration);
    currentTime.textContent = `${elapsed} / ${duration}`;
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
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
    const albumArtUrl = `${baseUrl}/GetArt?guid=${guid}`;
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

function sendTitleBrowseResponse(guid) {
    const items = [
        { guid: guid, name: 'Play Now', type: 'PlayTitle' },
        { guid: guid, name: 'Play Next', type: 'PlayTitle' },
        { guid: guid, name: 'Replace Queue', type: 'PlayTitle' },
        { guid: guid, name: 'Add To Queue', type: 'PlayTitle' },
    ];
    renderBrowse(items)
}

function getMappedName(name) {
    if (name.includes('Now')) return 'Now';
    if (name.includes('Next')) return 'Next';
    if (name.includes('Replace')) return 'Replace';
    if (name.includes('Queue')) return 'Append';
    return 'Unknown'; // Default value if no match is found
}

function getBrowseCommandFromName(itemName) {
    const nameMap = {
        'Now Playing Queue': 'BrowseNowPlaying',
        'My Music': 'BrowseMyMusic',
        'Recently Tuned': 'BrowseRecent',
        'Albums': 'BrowseAlbums',
        'Artists': 'BrowseArtists',
        'Composers': 'BrowseComposers',
        'Genres': 'BrowseGenres',
        'Songs': 'BrowseTitles',
        'Online': 'BrowseRadioSources',
        // Add more as needed
    };
    return nameMap[itemName] || null;
}

function getBrowseTypeFromAction(itemAction) {
    const nameMap = {
        'BrowseNowPlaying': 'Now Playing Queue',
        'BrowseMyMusic': 'My Music',
        'BrowseRecent': 'Recently Tuned',
        'BrowseAlbums': 'Albums',
        'BrowseArtists': 'Artists',
        'BrowseComposers': 'Composers',
        'BrowseGenres': 'Genres',
        'BrowseRadioSources': 'Online',
        // Add more as needed
    };
    return nameMap[itemAction] || null;
}

function getBrowseTypeFromName(itemName) {
    const nameMap = {
        'Now Playing Queue': 'NowPlaying',
        'My Music': 'MyMusic',
        'Recently Tuned': 'Recent',
        'Albums': 'Album',
        'Artists': 'Artist',
        'Composers': 'Composer',
        'Genres': 'Genre',
        //'Online': 'RadioSources',
        // Add more as needed
    };
    return nameMap[itemName] || null;
}

async function fetchBrowse(guid, name, type, action, addToPath = false) {

    let commands = [];

    let prevType = type; // Store the previous type for comparison
    type = getBrowseTypeFromName(name) || type; // Update type based on the item name, fallback to the provided type
    let browseCommand = getBrowseCommandFromName(name);

    //console.log(`fetchBrowse: guid =${guid}, name = ${name}, type = ${type},  action = ${action}, addToPath = ${addToPath}`);

    //console.log(`fetchBrowse: guid =${guid}, name = ${name}, type = ${type},  prevType = ${prevType}, browseCommand = ${browseCommand}, action = ${action}, addToPath = ${addToPath}`);

    if (!guid) {
        commands.push('ClearMusicFilter', 'BrowseTopMenu');
        //} else if (action) {
        //    commands.push(`${action} ${guid}`);
    } else if (browseCommand) {
        commands.push('ClearMusicFilter', 'ClearRadioFilter', browseCommand);
    } else {
        switch (type) {
            case 'PickItem':
                commands.push(`AckPickItem ${guid}`);
                // If this PickItem is a play action, go up two levels after sending the command
                const playActions = ["Play Now", "Play Next", "Replace Queue", "Add To Queue"];
                if (playActions.some(action => action.toLowerCase() === name.toLowerCase())) {
                    await sendCommand(commands);
                    await browseUp(2);
                    return;
                }
                else if (action === 'action') { // Check if 'action' for spotify account change   
                    await sendCommand(commands);
                    await browseUp(1);
                    return;
                }
                break;
            case 'Album':
                albumGuid = guid; // Store the album GUID
                commands.push(`SetMusicFilter Album={${guid}}`, 'BrowseTitles');
                break;
            case 'Artist':
                commands.push(`SetMusicFilter Artist={${guid}}`, 'BrowseAlbums');
                break;
            case 'Composer':
                commands.push(`SetMusicFilter Composer={${guid}}`, 'BrowseTitles');
                break;
            case 'Genre':
                commands.push(`SetMusicFilter Genre={${guid}}`, 'BrowseAlbums');
                break;
            case 'Title':
                if (name === 'Play all') {
                    // Special case for "Play all"  when 'SetOption supports_playnow=true' is set in init commands sent to MMS -- Not used in this version
                    const playOption = getMappedName(name || 'Now');
                    //const albumGuid = albumGuid || guid; // Use the album GUID from the previous browse menu
                    //console.log(`Play all: ${guid}, albumGuid: ${albumGuid}, playOption: ${playOption}`);
                    commands.push(`PlayAlbum ${albumGuid} ${playOption}`);
                } else {
                    //console.log(`Not Play all: ${guid}`);
                    sendTitleBrowseResponse(guid);
                }
                return;
            case 'PlayTitle':
                const playCommand = getMappedName(name || 'Now');
                commands.push(`PlayTitle ${guid} ${playCommand}`);
                await sendCommand(commands);
                await browseUp(2); // Go up one level and refresh
                return;
            default:
                commands.push('ClearMusicFilter', 'ClearRadioFilter', 'BrowseTopMenu');
        }
    }

    // Update the browse path if needed
    if (addToPath && guid) {
        browsePath.push({ guid, name, type, action });
    } else if (!guid) {
        browsePath = [];
    }

    await sendCommand(commands);
}

async function browseUp(levels = 1) {
    // Pop the desired number of levels, but not below 0
    for (let i = 0; i < levels && browsePath.length > 0; i++) {
        browsePath.pop();
    }
    renderBrowsePath(browsePath);

    // Refresh the browse list at the new level
    if (browsePath.length > 0) {
        const parent = browsePath[browsePath.length - 1];
        await fetchBrowse(parent.guid, parent.name, parent.type, parent.action, false);
    } else {
        await fetchBrowse();
    }
}

async function pollMmsStatus() {
    if (isPolling) return; // Prevent overlapping polls
    isPolling = true;
    const url = `http://${CONFIG.BASE_IP}/api/?clientId=${clientID}`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);    //15 seconds timeout

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        const text = await response.text();
        const data = JSON.parse(text);

        // --- Handle events ---
        if (data.events) {
            //console.log('Processing events:', data.events);
            try {
                const flatEvents = eventsArrayToObject(data.events);
                processEvents(flatEvents);
            } catch (err) {
                console.error('Error in processEvents:', err);
            }
        }

        // --- Handle browse ---
        if (data.browse) {
            //console.log('Processing browse:', data.browse);
            try {
                const browse = normalizeKeysRecursive(data.browse);
                processBrowse(browse);
            } catch (err) {
                console.error('Error in processBrowse:', err);
            }
        }

    } catch (e) {
        if (e.name === 'AbortError') {
            console.error('Timeout waiting for MMS response');
        } else {
            console.error('Error in pollMmsStatus:', e);
        }
    } finally {
        isPolling = false; // Always clear the flag
    }
}

function setupIntersectionObserver() {
    const items = browseItemsElement.querySelectorAll('.browse-item');

    // Create an Intersection Observer
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const item = entry.target;
                const img = item.querySelector('img');
                const guid = img ? img.getAttribute('data-guid') : null;

                if (guid && !albumArtCache[guid]) {
                    // Fetch album art for the visible item
                    const albumArtUrl = `${baseUrl}/GetArt?guid=${guid}`;
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
        root: browseItemsElement, // Observe within the scrollable container
        rootMargin: '0px', // No margin around the viewport
        threshold: 0.1, // Trigger when 10% of the item is visible
    });

    // Observe each item
    items.forEach((item) => observer.observe(item));
}

function renderBrowsePath(path) {
    // Clear the existing path
    browsePathElement.innerHTML = '';

    // Always include "Home" as the root
    const homeSpan = document.createElement('span');
    homeSpan.className = 'path-segment';
    homeSpan.textContent = 'Home';
    homeSpan.onclick = () => {
        isTuneBridgeActive = false; // <-- Add this line
        fetchBrowse(); // Fetch the top-level items
    };
    browsePathElement.appendChild(homeSpan);

    if (Array.isArray(path) && path.length > 0) {
        path.forEach((segment, index) => {
            // Add a separator before each segment
            const separator = document.createElement('span');
            separator.textContent = ' > ';
            browsePathElement.appendChild(separator);

            const pathSpan = document.createElement('span');
            pathSpan.className = 'path-segment';
            pathSpan.textContent = segment.name;
            pathSpan.onclick = () => {
                isTuneBridgeActive = false; // <-- Add this line
                browsePath = browsePath.slice(0, index + 1);
                fetchBrowse(segment.guid, segment.name, segment.type, false);
            };
            browsePathElement.appendChild(pathSpan);
        });
    }
}

function processBrowse(browse) {
    if (browse && Array.isArray(browse.items)) {
        if (browse.messageId === 'BrowsePickList') {
            browse.items = browse.items.map(item => ({ ...item, type: 'PickItem' }));
        }
        if (browse.messageId === 'BrowseInstances') {
            populateInstances(browse.items);
        } else {
            // Only set the path to TuneBridge caption if TuneBridge was just activated
            if (isTuneBridgeActive && browse.caption) {
                browsePath = [{ name: browse.caption, guid: null, type: 'TuneBridge' }];
                isTuneBridgeActive = false; // Reset after first use!
            }
            renderBrowse(browse.items);
            renderBrowsePath(browsePath);
        }
    }
}

function renderBrowse(items) {
    // Clear existing items
    browseItemsElement.innerHTML = '';

    if (!Array.isArray(items) || items.length === 0) {
        browseItemsElement.innerHTML = '<p>No items found</p>';
        return;
    }

    // Render all items
    items.forEach((item) => {
        if (!item.guid) {
            return; // Skip items without a valid GUID
        }

        const div = document.createElement('div');
        div.className = 'browse-item';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.marginBottom = '0.5rem';

        // Add album art placeholder
        const img = document.createElement('img');
        img.alt = item.albumName || item.name || 'Art';
        img.style.width = '50px';
        img.style.height = '50px';
        img.style.objectFit = 'cover';
        img.style.marginRight = '1rem';
        img.style.borderRadius = '4px';

        // Use artGuid for album art if available, otherwise fallback to guid
        const artGuid = item.artGuid || item.guid;
        img.src = albumArtCache[artGuid] || '';
        img.setAttribute('data-guid', artGuid);
        div.appendChild(img);

        // Create a container for text (album name and artist)
        const textContainer = document.createElement('div');
        textContainer.style.display = 'flex';
        textContainer.style.flexDirection = 'column';
        textContainer.style.flexGrow = '1';

        // Title or album name
        const mainSpan = document.createElement('span');
        if (item.type === 'Album' || item.mediaObjectType === 'Album') {
            mainSpan.textContent = item.albumName || item.name || item.value || 'Unnamed';
        } else if (item.type === 'Title' || item.mediaObjectType === 'Title') {
            mainSpan.textContent = item.name || item.value || 'Unnamed';
        } else {
            mainSpan.textContent = item.name || item.albumName || item.value || 'Unnamed';
        }
        mainSpan.style.fontWeight = 'bold';
        textContainer.appendChild(mainSpan);

        // Artist (for albums and tracks)
        if ((item.type === 'Album' || item.mediaObjectType === 'Album') && item.artistName) {
            const artistSpan = document.createElement('span');
            artistSpan.textContent = item.artistName;
            artistSpan.style.fontSize = '0.9em';
            artistSpan.style.color = '#aaa';
            textContainer.appendChild(artistSpan);
        } else if ((item.type === 'Title' || item.mediaObjectType === 'Title') && item.artistName) {
            const artistSpan = document.createElement('span');
            artistSpan.textContent = item.artistName;
            artistSpan.style.fontSize = '0.9em';
            artistSpan.style.color = '#aaa';
            textContainer.appendChild(artistSpan);
        }

        div.appendChild(textContainer);

        div.style.cursor = 'pointer';
        div.onclick = () => {
            if (item.listAction && item.listAction.startsWith('Initiate')) {
                //console.log(`📤 Initiating search for: ${item.listAction}`);
                // Extract search type, e.g., 'Album' from 'Initiate AlbumSearch'
                const searchType = item.listAction.split(' ')[1] || 'Album';
                showSearchModal(searchType);
            } else {
                // Existing browse logic
                const addToBrowse = true;
                fetchBrowse(
                    item.guid,
                    item.albumName || item.name || item.value,
                    item.type || item.mediaObjectType,
                    item.action,
                    addToBrowse,
                );
            }
        };

        browseItemsElement.appendChild(div);
    });

    setupIntersectionObserver();
}

function renderBrowseItems(items) {
    // Clear existing items
    browseItemsElement.innerHTML = '';

    items.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'browse-item';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.marginBottom = '0.5rem';

        // Add album art if available
        if (item.guid) {
            const img = document.createElement('img');
            img.src = `${baseUrl}/GetArt?guid=${item.guid}`;
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

        browseItemsElement.appendChild(itemDiv);
    });

    //console.log('✅ Browse items rendered:', items);
}

// On load, just initialize and poll
window.onload = async function () {
    if (browseContainerElement && browseButton) {
        browseContainerElement.style.display = 'none'; // Hides browse UI on load
        browseButton.classList.remove('active');
    }
    await initializeMmsClient();
    setInterval(pollMmsStatus, CONFIG.POLL_TIME);
};

async function initializeMmsClient() {
    const initCommands = [

        'SetClientType jsonApi',
        //'SetClientVersion 1.0.0.0',
        'SetOption supports_urls=true',
        `SetHost ${CONFIG.BASE_IP}`,
        'SetPickListCount 100000',
        'SetOption supports_inputbox=true',
        //'SetOption supports_playnow=true',

        //'BrowseInstances'
        //'GetStatus',  //called after instance changed
        //'SubscribeEvents',  //called after instance changed

    ];
    await sendCommand(initCommands);
    await sendCommand('BrowseInstances');
}

function processEvents(events) {
    //console.log('processEvents:', events); // <-- Add this
    lastUpdate = Date.now();

    updateAblumArt(events);
    updateMetadata(events);
    updateCommandState(events);
    updateVolume(events);
    updatePlayPause(events);

    if (events.inputBox) {
        showInputBoxFromJson(events.inputBox);
    }
}

function showSearchModal(searchType) {
    // Remove any existing modal
    let oldModal = document.getElementById('searchModal');
    if (oldModal) oldModal.remove();

    // Create modal elements
    const modal = document.createElement('div');
    modal.id = 'searchModal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.5)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '9999';

    const box = document.createElement('div');
    box.style.background = '#222';
    box.style.padding = '2rem';
    box.style.borderRadius = '8px';
    box.style.boxShadow = '0 2px 12px #000';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';

    const label = document.createElement('label');
    label.textContent = `Search ${searchType}:`;
    label.style.color = '#fff';
    label.style.marginBottom = '1rem';

    const input = document.createElement('input');
    input.type = 'text';
    input.style.padding = '0.5rem';
    input.style.marginBottom = '1rem';
    input.style.width = '200px';

    const button = document.createElement('button');
    button.textContent = 'Search';
    button.style.padding = '0.5rem 1rem';
    button.onclick = async () => {
        const searchString = input.value.trim();
        if (searchString) {
            // Always add 's' to the searchType for the browse command
            await sendCommand([
                `SetMusicFilter Search="${searchString}"`,
                `Browse${searchType}s`
            ]);
        }
        modal.remove();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') button.click();
    });

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.marginLeft = '1rem';
    cancel.onclick = () => modal.remove();

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.appendChild(button);
    btnRow.appendChild(cancel);

    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(btnRow);
    modal.appendChild(box);
    document.body.appendChild(modal);

    input.focus();
}

function updateAblumArt(events) {
    // Album art
    if (events.nowPlayingGuid !== undefined) {
        guid = events.nowPlayingGuid;
        albumArtElement.src = guid && baseUrl ? `${baseUrl}/GetArt?guid=${guid}` : '';
    }

    if (events.mediaArtChanged !== undefined) {
        albumArtElement.src = guid && baseUrl ? `${baseUrl}/GetArt?guid=${guid}` : '';
    }
}

function updateCommandState(events) {

    if (events.thumbsUp !== undefined) {
        thumbsUpAvailable = events.thumbsUp == -1 ? false : true;
        thumbsUp = events.thumbsUp == -1 ? true : false;
        updateButtonState(thumbsUpButton, thumbsUpAvailable, thumbsUp, '👍');
    }

    if (events.thumbsDown !== undefined) {
        thumbsDownAvailable = events.thumbsDown == -1 ? false : true;
        thumbsDown = events.thumbsDown == -1 ? true : false;
        updateButtonState(thumbsDownButton, thumbsDownAvailable, thumbsDown, '👎');
    }

    if (events.shuffleAvailable !== undefined) {
        shuffleAvailable = events.shuffleAvailable;
        if (events.shuffle !== undefined) {
            shuffle = events.shuffle;
        }
        updateButtonState(shuffleButton, shuffleAvailable, shuffle, '🔀');
    }

    if (events.repeatAvailable !== undefined) {
        repeatAvailable = events.repeatAvailable;
        if (events.repeat !== undefined) {
            repeat = events.repeat;
        }
        updateButtonState(repeatButton, repeatAvailable, repeat, '🔁');
    }

    if (events.skipPrevAvailable !== undefined) {
        skipPrevAvailable = events.skipPrevAvailable;
        updateButtonState(skipPrevButton, skipPrevAvailable, true, '⏮️');
    }

    if (events.skipNextAvailable !== undefined) {
        skipNextAvailable = events.skipNextAvailable;
        updateButtonState(skipNextButton, skipNextAvailable, true, '⏭️');
    }
}

function updatePlayPause(events) {
    // mediaControl & 0x01 === 1 → playing  4097
    // mediaControl & 0x02 === 2 → paused  4098
    // mediaControl & 0x03 === 3 → stopped/idle 4099
    // bit 12 = session active, ignore for now

    let playStateChanged = false;
    if (events.playPauseAvailable !== undefined) playPauseAvailable = events.playPauseAvailable;
    if (events.mediaControl !== undefined) {
        mediaControl = events.mediaControl;
        const state = mediaControl & 0x03;
        const newPlayState = (state === 1);
        playStateChanged = (playState !== newPlayState);
        playState = newPlayState;
    } else if (events.playState !== undefined) {
        const newPlayState = events.playState == 1 ? true : false;
        playStateChanged = (playState !== newPlayState);
        playState = newPlayState;
    }
    if (
        events.playPauseAvailable !== undefined ||
        events.playState !== undefined ||
        events.mediaControl !== undefined
    ) {
        updatePlayPauseButton();
    }

    if (events.trackTime !== undefined) elapsed = events.trackTime;
    if (events.trackDuration !== undefined) duration = events.trackDuration;

    // Always update playback progress if playState changed or time/duration updated
    if (
        playStateChanged ||
        events.trackDuration !== undefined ||
        events.trackTime !== undefined
    ) {
        updatePlaybackProgress();
    }
}

function updatePlayPauseButton() {
    //console.log(`🔄 updatePlayPauseButton called with playState: ${playState}, playPauseAvailable: ${playPauseAvailable}, mediaControl: ${mediaControl}`);

    if (playState) {
        playPauseButton.textContent = '⏸️';
        //set active state
        //playPauseButton.classList.add('active');
        //playPauseButton.classList.remove('inactive');

    } else {
        playPauseButton.textContent = '▶️';
        //set inactive state
        //playPauseButton.classList.remove('active');
        //playPauseButton.classList.add('inactive');

    }
}

function updateMetadata(events) {
    if (events.title !== undefined) titleElement.textContent = events.title;
    if (events.artist !== undefined) artistElement.textContent = events.artist;
    if (events.album !== undefined) albumElement.textContent = events.album;
    if (events.genre !== undefined) genreElement.textContent = events.genre;

    if (events.metaData1 !== undefined) metaData1Element.textContent = events.metaData1;
    if (events.metaData2 !== undefined) metaData2Element.textContent = events.metaData2;
    if (events.metaData3 !== undefined) metaData3Element.textContent = events.metaData3;
    if (events.metaData4 !== undefined) metaData4Element.textContent = events.metaData4;


    if (events.nowPlayingSrceName !== undefined) {
        nowPlayingSrceNameElement.textContent = events.nowPlayingSrceName;
        updateNowPlayingHeader(events.nowPlayingSrceName, events.album);
    }
}

function updateVolume(events) {
    if (events.mute !== undefined) {
        mute = events.mute; // Update the current mute state to the new mute state   
        muteButton.textContent = mute ? '🔇' : '🔊';
        //console.log(`🔊 Mute updated: ${mute}`);
    }

    if (events.volume !== undefined) {
        volume = events.volume; // Update the current mute state to the new mute state   
        const percentage = (volume / 50) * 100; // Convert server volume (0-50) to percentage (0-100%)
        volumeSlider.value = volume; // Set the slider's value (0-50)
        volumeSlider.style.background = `linear-gradient(to right, green 0%, green ${percentage}%, #ccc ${percentage}%, #ccc 100%)`;
        //console.log(`🔊 Volume updated: ${volume} (${percentage}%)`);
    }
}

function normalizeKeysRecursive(obj) {
    if (Array.isArray(obj)) {
        return obj.map(normalizeKeysRecursive);
    } else if (obj && typeof obj === 'object') {
        const out = {};
        for (const k in obj) {
            const camelKey = k.charAt(0).toLowerCase() + k.slice(1);
            out[camelKey] = normalizeKeysRecursive(obj[k]);
        }
        return out;
    }
    return obj;
}

function eventsArrayToObject(events) {
    const obj = {};
    events.forEach(ev => {
        // Convert name to camelCase for consistency
        const key = ev.name.charAt(0).toLowerCase() + ev.name.slice(1);
        obj[key] = ev.value;
    });
    return obj;
}