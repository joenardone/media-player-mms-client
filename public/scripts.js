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

const albumArtQueue = new Map(); // Use a Map to manage the queue
const processedGuids = new Set();

const clientID = generateUUID(); // Generate a proper UUID
const socket = new WebSocket(`ws://localhost:3000?clientID=${clientID}`);


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
                    //console.log(`🔄 Instance changed to: ${currentInstance}`);
                } else if (data.key === 'TopMenu' && data.value === 'Ok') {
                    browsePath = [];
                    updateBrowsePath();
                    console.log(`🔄 Browse path set to Top menu`);
                }
                break;

            case 'getStatus':
                if (data.instance !== currentInstance) return;

                baseWebUrl = data.data.baseWebUrl || '';
                //console.log(`🌐 Updated baseWebUrl: ${baseWebUrl}`);

                let {
                    trackName,
                    artistName,
                    albumName,
                    nowPlayingGuid,
                    trackDuration,
                    trackTime,
                    playState,
                } = data.data;

                const trackInfo = document.getElementById('trackInfo');
                trackInfo.textContent = trackName
                    ? `${artistName || ''} - ${trackName || ''} (${albumName || ''})`.trim()
                    : 'Nothing playing';

                const albumArt = document.getElementById('albumArt');
                albumArt.src = nowPlayingGuid && baseWebUrl ? `${baseWebUrl}GetArt?guid=${nowPlayingGuid}` : '';
                albumArt.alt = trackName || 'No Album Art';

                elapsed = trackTime || 0;
                duration = trackDuration || 0;
                currentState = playState || 'Stopped';
                lastUpdate = Date.now();
                updateProgressBar();
                updateTimerFromState();
                break;

            case 'stateChanged':
                if (data.instance !== currentInstance) return;

                const events = data.events;
                if (events.TrackTime) elapsed = parseInt(events.TrackTime, 10);
                if (events.TrackDuration) duration = parseInt(events.TrackDuration, 10);
                if (events.PlayState) currentState = events.PlayState;
                if (events.TrackName) {
                    document.getElementById('trackInfo').textContent = events.TrackName;
                }

                // Update album art if nowPlayingGuid is present
                if (events.NowPlayingGuid && baseWebUrl) {
                    const albumArt = document.getElementById('albumArt');
                    albumArt.src = `${baseWebUrl}GetArt?guid=${events.NowPlayingGuid}`;
                    albumArt.alt = events.TrackName || 'No Album Art';
                }

                lastUpdate = Date.now();
                updateProgressBar();
                updateTimerFromState();
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

function updateProgressBar() {
    const pct = duration > 0 ? (elapsed / duration) * 100 : 0;
    document.getElementById('progressBar').style.width = `${pct}%`;
    document.getElementById('timeInfo').textContent = `${formatTime(elapsed)} / ${formatTime(duration)}`;
}

function updateTimerFromState() {
    clearInterval(timer);
    if (currentState === 'Playing') {
        timer = setInterval(() => {
            const now = Date.now();
            elapsed += Math.floor((now - lastUpdate) / 1000);
            lastUpdate = now;
            updateProgressBar();
        }, 1000);
    }
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateBrowse() {
    const container = document.getElementById('browseContainer');
    if (container.style.display === 'block') {
        fetchBrowse();
    }
}

function toggleBrowse() {
    const container = document.getElementById('browseContainer');
    container.style.display = container.style.display === 'none' ? 'block' : 'none';
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
