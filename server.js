const net = require('net');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const xml2js = require('xml2js');
const express = require('express');
const path = require('path');

const MMS_IP = '192.168.162.64';
const MMS_PORT = 5004;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clientConnections = {}; // Track connections by clientID

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

//let clients = [];
//let instanceSockets = {};
//let lastInstance = null;
//let instanceNames = [];
//let nowPlayingByZone = {};

//let mmsClient = null;
//let mmsConnected = false;
//let mmsInitialized = false;
//let mmsBuffer = '';
//let currentBrowseRes = null;
//let currentInstance = null;

function sendInitializationCommands(clientID) {
  const clientMmsClient = clientConnections[clientID]?.mmsClient;
  if (!clientMmsClient) {
    console.error(`❌ MMS client not found for client ${clientID}`);
    return;
  }

  const initCommands = [
    'SetClientType DemoClient',
    'SetClientVersion 1.0.0.0',
    //'SetOption supports_playnow=true',
    'SetOption supports_inputbox=true',
    'SetOption supports_urls=true',
    `SetHost ${MMS_IP}`,
    'SetXmlMode Lists',
    'SetEncoding 65001',
    'SetPickListCount 100000',
    'BrowseInstances',
  ];

  initCommands.forEach((cmd, i) => {
    setTimeout(() => {
      console.log(`[TX] Initialization for ${clientID}: ${cmd}`);
      clientMmsClient.write(`${cmd}\r\n`);
    }, i * 250);
  });
}

wss.on('connection', (ws, req) => {
  const clientID = new URLSearchParams(req.url.split('?')[1]).get('clientID');
  if (!clientID) {
    console.error('❌ Missing clientID, closing connection.');
    ws.close();
    return;
  }

  console.log(`🌐 WebSocket client connected: ${clientID}`);
  clientConnections[clientID] = {
    ws,
    mmsClient: new net.Socket(),
    state: {
      currentInstance: null,
      browsePath: [],
    },
    timeoutHandle: null, // Add timeoutHandle here
  };

  const clientMmsClient = clientConnections[clientID].mmsClient;

  clientMmsClient.connect(MMS_PORT, MMS_IP, () => {
    console.log(`🔌 Connected to MMS for client ${clientID}`);
  });

  clientMmsClient.on('data', async (data) => {
    const client = clientConnections[clientID];
    console.log(`Received MMS data for client ${clientID} :`, data.toString());
    client.mmsBuffer = (client.mmsBuffer || '') + data.toString();

    // Process the buffer
    client.mmsBuffer = await processMMSBuffer(client.mmsBuffer, client.timeoutHandle, clientID);
  });

  clientMmsClient.on('error', (err) => {
    console.error(`❌ MMS connection error for client ${clientID}:`, err.message);
  });

  clientMmsClient.on('close', () => {
    console.log(`🔌 MMS connection closed for client ${clientID}`);
  });

  // Send initialization commands to MMS
  sendInitializationCommands(clientID);

  // Handle WebSocket messages from the client
  ws.on('message', (message) => {
    try {
      const decodedMessage = message.toString();
      const data = JSON.parse(decodedMessage);

      console.log(`📩 Message from ${clientID}:`, JSON.stringify(data, null, 2));

      if (data.type === 'browse') {
        handleBrowseRequest(data, clientID);
      } else if (data.type === 'command') {
        handleCommandRequest(data, clientID);
      } else {
        console.warn(`❓ Unknown message type from ${clientID}:`, data.type);
      }
    } catch (err) {
      console.error(`❌ Error processing message from ${clientID}:`, err.message);
      console.log(`📩 Raw message from ${clientID}:`, message.toString());
    }
  });

  // Handle WebSocket disconnection
  ws.on('close', () => {
    console.log(`❌ WebSocket client disconnected: ${clientID}`);
    delete clientConnections[clientID];
  });
});

function broadcastToClients(data) {
  const msg = JSON.stringify(data);
  Object.values(clientConnections).forEach(({ ws }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
      console.log(`📤 Sent data to client:`, data);
    }
  });
}

function sendToClient(clientID, data) {
  const client = clientConnections[clientID];
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(data));
    console.log(`📤 Sent data to client ${clientID}:`, data);
  } else {
    console.error(`❌ Unable to send data to client ${clientID}: WebSocket not open.`);
  }
}

function ensureMMSConnection(clientID, callback) {
  const client = clientConnections[clientID];
  if (!client) {
    console.error(`❌ Client not found for clientID: ${clientID}`);
    return;
  }

  const clientMmsClient = client.mmsClient;

  // Check if the MMS client is already connected
  if (clientMmsClient && clientMmsClient.readyState === 'open') {
    console.log(`✅ MMS client already connected for client: ${clientID}`);
    if (callback) callback(clientID); // Pass clientID to the callback
    return;
  }

  // Initialize the MMS client if not connected
  clientMmsClient.connect(MMS_PORT, MMS_IP, () => {
    console.log(`🔌 Connected to MMS server for client: ${clientID}`);
    if (callback) callback(clientID); // Pass clientID to the callback
  });

  clientMmsClient.on('error', (err) => {
    console.error(`❌ MMS connection error for client ${clientID}:`, err.message);
  });

  clientMmsClient.on('close', () => {
    console.log(`🔌 MMS connection closed for client ${clientID}`);
  });
}

function extractInstance(rawData) {
  const match = rawData.match(/ReportState\s+([^\s]+)/);
  return match ? match[1] : null; // Return the instance name or null if not found
}

async function parseInstancesXml(xml) {
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

  const startTag = xml.indexOf('<Instances');
  const endTag = xml.indexOf('</Instances>') + '</Instances>'.length;

  if (startTag === -1 || endTag === -1) {
    console.error('❌ Error: <Instances> block not found in XML.');
    return [];
  }

  const cleanXml = xml.slice(startTag, endTag).trim();
  console.log(`📥 Extracted <Instances> XML:`, cleanXml);

  try {
    const result = await parser.parseStringPromise(cleanXml);
    if (result && result.Instances && result.Instances.Instance) {
      const rawInstances = Array.isArray(result.Instances.Instance)
        ? result.Instances.Instance
        : [result.Instances.Instance];

      const instances = rawInstances.map((instance) => ({
        name: instance.name,
        friendlyName: instance.friendlyName || instance.name,
        art: instance.mArt || '',
      }));

      console.log(`✅ Parsed Instances:`, instances);
      return instances;
    }
  } catch (err) {
    console.error('❌ Error parsing Instances XML:', err);
  }

  return [];
}

function parseXlm(rawData) {
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

  if (rawData.includes('<Instances') && rawData.includes('</Instances>')) {
    return { type: 'instances', data: parseInstancesXml(rawData) };
  } else if (rawData.includes('<') && rawData.includes('</')) {
    return { type: 'browse', data: parseListXml(rawData) };
  } else {
    console.error('❌ Error: Unknown XML format.', rawData);
    return { type: 'unknown', data: null };
  }
}

async function parseListXml(xml) {
  const firstTag = xml.indexOf('<');
  if (firstTag > 0) xml = xml.slice(firstTag); // Remove any leading non-XML content

  try {
    // Parse the XML string into a JavaScript object
    const result = await xml2js.parseStringPromise(xml, { explicitArray: false });
    console.log('📥 Parsed XML:', JSON.stringify(result, null, 2)); // Log the parsed XML structure

    const rootKey = Object.keys(result)[0]; // Get the root element (e.g., Titles, PickList)
    const root = result[rootKey];

    if (!root) {
      console.error('❌ Error: Root element not found in XML.');
      return [];
    }

    // Determine the child tag based on the root element
    const childTag = {
      PickList: 'PickItem',
      NowPlaying: 'Title',
      Albums: 'Album',
      Titles: 'Title',
      Genres: 'Genre',
      Composers: 'Composer',
      Artists: 'Artist',
      RadioSources: 'RadioSource',
      RadioStations: 'RadioStation',
      RadioGenres: 'RadioGenre',
    }[rootKey] || 'PickItem';

    console.log(`🔍 Root Key: ${rootKey}, Child Tag: ${childTag}`);

    const rawItems = root[childTag]; // Extract the child elements (e.g., Title, PickItem)
    console.log('📥 Raw Items:', JSON.stringify(rawItems, null, 2)); // Log the raw items

    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    // Map the raw items into a structured format
    return items.map((item) => {
      const attrs = item.$ || item; // Use attributes or the item itself
      const guid = attrs.guid || attrs.id || ''; // Use guid or id as fallback
      const artGuid = attrs.artGuid || guid; // Prioritize artGuid, fallback to guid

      return {
        guid,
        name: attrs.name || attrs.title || 'Unnamed',
        type: childTag,
        hasChildren: attrs.hasChildren === '1',
        hasArt: attrs.hasArt === '1',
        artGuid, // Include artGuid in the response
        browseAction: attrs.browseAction || null,
        duration: attrs.duration || '', // Include duration if available
        track: attrs.track || '', // Include track number if available
        album: attrs.album || '', // Include album name if available
        artist: attrs.artist || '', // Include artist name if available
      };
    });
  } catch (err) {
    console.error('❌ Error parsing List XML:', err.message);
    console.error('❌ Raw XML:', xml);
    return [];
  }
}

function initializeMMSClient(clientID) {
  if (mmsClient && mmsConnected) {
    console.log(`✅ MMS client already connected for client: ${clientID}`);
    return;
  }

  console.log(`🔌 Initializing MMS client for client: ${clientID}...`);
  mmsClient = new net.Socket();

  mmsClient.connect(MMS_PORT, MMS_IP, () => {
    console.log(`🔌 Connected to MMS server for client: ${clientID}`);
    mmsConnected = true;
  });

  let mmsBuffer = '';
  let timeoutHandle = null;

  mmsClient.on('data', async (data) => {
    mmsBuffer += data.toString();
    console.log(`[RX] Data from MMS for client ${clientID}: ${data.toString()}`);

    // Clear any existing timeout
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    // Set a timeout to handle cases where data is incomplete
    timeoutHandle = setTimeout(() => {
      console.error(`❌ Timeout waiting for complete data for client ${clientID}. Clearing buffer:`, mmsBuffer);
      console.log(`🔌 MMS client connected: ${mmsClient && !mmsClient.destroyed}`);
      mmsBuffer = ''; // Clear the buffer
    }, 30000); // 30 seconds timeout

    // Process the buffer
    mmsBuffer = await processMMSBuffer(mmsBuffer, timeoutHandle, clientID);
  });

  mmsClient.on('error', (err) => {
    console.error(`❌ MMS connection error for client ${clientID}:`, err.message);
    mmsConnected = false;
    mmsClient.destroy();
    mmsClient = null;
  });

  mmsClient.on('close', () => {
    console.log(`🔌 MMS connection closed for client ${clientID}`);
    mmsConnected = false;
    mmsClient = null;
  });
}

async function parseXlm(rawData) {
  if (rawData.includes('<Instances') && rawData.includes('</Instances>')) {
    const instances = await parseInstancesXml(rawData);
    return { type: 'instances', data: instances };
  } else if (rawData.includes('<') && rawData.includes('</')) {
    const browseData = await parseListXml(rawData);
    return { type: 'browse', data: browseData };
  } else {
    console.error('❌ Error: Unknown XML format.', rawData);
    return { type: 'unknown', data: null };
  }
}

function parseGetStatus(rawData) {
  const getMatch = (pattern, fallback = '') => (rawData.match(pattern)?.[1] || fallback).trim();
  const getInt = (pattern, fallback = 0) => parseInt(rawData.match(pattern)?.[1] || fallback, 10);
  const getBool = (pattern) => rawData.match(pattern)?.[1] === 'True';

  return {
    instance: getMatch(/InstanceName=([^\n\r]*)/, 'None'),
    baseWebUrl: getMatch(/BaseWebUrl=([^\n\r]*)/, MMS_IP),
    playState: getMatch(/PlayState=([^\n\r]*)/, 'Stopped'),
    trackName: getMatch(/TrackName=([^\n\r]*)/, ''),
    artistName: getMatch(/ArtistName=([^\n\r]*)/, ''),
    mediaName: getMatch(/MediaName=([^\n\r]*)/, ''),
    trackDuration: getInt(/TrackDuration=(\d+)/),
    trackTime: getInt(/TrackTime=(\d+)/),
    nowPlayingGuid: getMatch(/NowPlayingGuid=\{([a-f0-9\-]{36})\}/i, '00000000-0000-0000-0000-000000000000'),
    trackQueueIndex: getInt(/TrackQueueIndex=(\d+)/),
    totalTracks: getInt(/TotalTracks=(\d+)/),
    shuffle: getBool(/Shuffle=(True|False)/),
    repeat: getBool(/Repeat=(True|False)/),
    thumbsUp: getInt(/ThumbsUp=(-1|0|1)/, -1),
    thumbsDown: getInt(/ThumbsDown=(-1|0|1)/, -1),
    volume: getInt(/Volume=(\d+)/, 50),
    mute: getBool(/Mute=(True|False)/),
    shuffleAvailable: getBool(/ShuffleAvailable=(True|False)/),
    repeatAvailable: getBool(/RepeatAvailable=(True|False)/),
    skipNextAvailable: getBool(/SkipNextAvailable=(True|False)/),
    skipPrevAvailable: getBool(/SkipPrevAvailable=(True|False)/),
    playPauseAvailable: getBool(/PlayPauseAvailable=(True|False)/),
    seekAvailable: getBool(/SeekAvailable=(True|False)/),
    // New fields
    metaLabel1: getMatch(/MetaLabel1=([^\n\r]*)/, ''),
    metaData1: getMatch(/MetaData1=([^\n\r]*)/, ''),
    metaLabel2: getMatch(/MetaLabel2=([^\n\r]*)/, ''),
    metaData2: getMatch(/MetaData2=([^\n\r]*)/, ''),
    metaLabel3: getMatch(/MetaLabel3=([^\n\r]*)/, ''),
    metaData3: getMatch(/MetaData3=([^\n\r]*)/, ''),
    metaLabel4: getMatch(/MetaLabel4=([^\n\r]*)/, ''),
    metaData4: getMatch(/MetaData4=([^\n\r]*)/, ''),
    nowPlayingType: getMatch(/NowPlayingType=([^\n\r]*)/, ''),
    nowPlayingSrce: getMatch(/NowPlayingSrce=([^\n\r]*)/, ''),
    nowPlayingSrceName: getMatch(/NowPlayingSrceName=([^\n\r]*)/, ''),
  };
}

function processGetStatusBuffer(buffer, clientID) {
  const cleanedBuffer = buffer.replace(/(?<!ReportState|StateChanged)\n/g, ' ');
  const lines = cleanedBuffer.split('\n').map(line => line.trim()).filter(Boolean);
  const relevantLines = lines.filter(line => line.startsWith('ReportState') || line.startsWith('StateChanged'));
  const parsedBuffer = relevantLines.join('\n');

  const instance = extractInstance(parsedBuffer);
  const parsedData = parseGetStatus(parsedBuffer);

  if (clientID) {
    sendToClient(clientID, { type: 'getStatus', instance, data: parsedData });
    console.log(`📤 Sent GetStatus data to client ${clientID}:`, parsedData);
  } else {
    console.error(`❌ Unable to send GetStatus data: clientID is undefined.`);
  }
}

async function processXmlData(xml, clientID) {
  try {
    const parsed = await parseXlm(xml);
    if (parsed.type === 'instances') {
      sendToClient(clientID, { type: 'instances', instances: parsed.data });
    } else if (parsed.type === 'browse') {
      sendToClient(clientID, { type: 'browse', items: parsed.data });
    } else {
      sendToClient(clientID, { type: 'xml', data: parsed.data });
    }
  } catch (err) {
    console.error(`❌ Error parsing XML for client ${clientID}:`, err);
  }
}

function processGetStatusData(buffer) {
  processGetStatusBuffer(buffer);
  getStatusBuffer = ''; // Reset the buffer
  isProcessingGetStatus = false;
}

function parseStateChanged(line) {
  const stateChangedMatch = line.match(/^StateChanged\s+(\S+)\s+(.+)$/);
  if (!stateChangedMatch) {
    console.error(`❌ Invalid StateChanged line: "${line}"`);
    return null;
  }

  const instance = stateChangedMatch[1]; // Extract the instance
  const stateData = stateChangedMatch[2]; // Extract the key-value pairs

  // Parse state data into key-value pairs
  const events = {};
  const keyValuePairs = stateData.match(/(\w+=[^=]*|[^=\s]+=[^=\s]*)/g); // Allow empty values
  if (keyValuePairs) {
    keyValuePairs.forEach((pair) => {
      const [key, ...valueParts] = pair.split('=');
      const value = valueParts.join('=').trim(); // Rejoin in case the value contains '=' or spaces

      // Handle complex values like UI=<...> or URLs
      if (value.startsWith('<') && value.endsWith('>')) {
        events[key] = value; // Keep the full value as-is
      } else if (value.startsWith('http')) {
        events[key] = value; // Keep URLs as-is
      } else {
        // Convert 'True'/'False' to boolean, and specific keys like ThumbsUp/ThumbsDown to integers
        if (key === 'ThumbsUp' || key === 'ThumbsDown') {
          events[key] = parseInt(value, 10); // Convert to integer
        } else {
          events[key] = value === 'True' ? true : value === 'False' ? false : value || ''; // Default to empty string
        }
      }
    });
  } else {
    console.warn(`❓ No key-value pairs found in StateChanged line: "${line}"`);
  }

  return { instance, events };
}

async function processMMSBuffer(mmsBuffer, timeoutHandle, clientID) {
  let getStatusBuffer = ''; // Buffer for GetStatus responses
  let isProcessingGetStatus = false; // Flag to indicate GetStatus processing
  let remainingBuffer = ''; // To store unprocessed or incomplete lines
  let xmlBuffer = ''; // To accumulate incomplete XML data

  // Append new data to the remaining buffer
  mmsBuffer = remainingBuffer + mmsBuffer;

  // Define a list of closing tags for XML detection
  const closingTags = [
    '</Instances>',
    '</PickList>',
    '</NowPlaying>',
    '</Albums>',
    '</Titles>',
    '</Genres>',
    '</Composers>',
    '</Artists>',
    '</RadioSources>',
    '</RadioStations>',
    '</RadioGenres>',
  ];

  // Process XML data if present
  if (mmsBuffer.includes('<') && mmsBuffer.includes('>')) {
    const xmlEndIndex = closingTags
      .map((tag) => mmsBuffer.indexOf(tag))
      .filter((index) => index !== -1)
      .sort((a, b) => a - b)[0]; // Find the earliest closing tag

    if (xmlEndIndex !== undefined) {
      const closingTag = closingTags.find((tag) => mmsBuffer.includes(tag));
      const xmlBlock = mmsBuffer.slice(0, xmlEndIndex + closingTag.length);
      mmsBuffer = mmsBuffer.slice(xmlEndIndex + closingTag.length).trimStart();

      xmlBuffer += xmlBlock; // Accumulate XML data

      try {
        await processXmlData(xmlBuffer, clientID); // Pass clientID here
        xmlBuffer = ''; // Clear the XML buffer after successful parsing
      } catch (err) {
        console.error(`❌ Error processing XML for client ${clientID}:`, err);
      }
    } else if (!mmsBuffer.includes('StateChanged')) {
      // If the XML is incomplete, accumulate it in the XML buffer
      xmlBuffer += mmsBuffer;

      // Log the current state of the buffer for debugging
      console.log(`Accumulating incomplete XML data for client ${clientID}:`, xmlBuffer);

      // Save the remaining buffer for the next chunk
      remainingBuffer = mmsBuffer;
      return remainingBuffer; // Exit early to wait for the next chunk
    }
  }

  // Handle non-XML data
  if (isProcessingGetStatus || mmsBuffer.includes('ReportState')) {
    // Start buffering for GetStatus on the first ReportState
    if (!isProcessingGetStatus && mmsBuffer.includes('ReportState')) {
      isProcessingGetStatus = true;
    }

    // Accumulate GetStatus data
    getStatusBuffer += mmsBuffer;

    // Check if the GetStatus response is complete
    if (getStatusBuffer.includes('StateChanged') && getStatusBuffer.includes('GetStatus=Done')) {
      processGetStatusBuffer(getStatusBuffer, clientID); // Pass clientID here

      // Reset flags and buffers
      getStatusBuffer = '';
      isProcessingGetStatus = false;

      // Clear the timeout after processing
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      return ''; // Clear the buffer after processing GetStatus
    } else {
      // If GetStatus is incomplete, save it in the remaining buffer
      remainingBuffer = getStatusBuffer;
      return remainingBuffer;
    }
  }

  // Handle standard commands when not processing GetStatus
  if (!isProcessingGetStatus) {
    // Process the buffer line by line
    while (mmsBuffer.includes('\n')) {
      const commandEndIndex = mmsBuffer.indexOf('\n'); // Find the end of the first line
      const command = mmsBuffer.slice(0, commandEndIndex).trim(); // Extract the first line
      mmsBuffer = mmsBuffer.slice(commandEndIndex + 1); // Remove the processed line from the buffer

      // Handle StateChanged messages
      if (command.startsWith('StateChanged')) {
        const parsed = parseStateChanged(command);
        if (parsed) {
          const { instance, events } = parsed;
          sendToClient(clientID, { type: 'stateChanged', instance, events }); // Pass clientID here
        }

        // Clear the timeout after processing
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        continue; // Process the next line
      }

      // Match key-value pairs (e.g., "SubscribeEvents True")
      const keyValueMatch = command.match(/^(\w+)\s+(.+)$/);
      if (keyValueMatch) {
        const key = keyValueMatch[1];
        const value = keyValueMatch[2];
        console.log(`✅ Key-Value Pair for client ${clientID}: ${key} = ${value}`);

        // Clear the timeout after processing
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        continue; // Process the next line
      }

      // Handle unrecognized data
      console.log(`❓ Unhandled data for client ${clientID}: "${command}"`);
    }

    // Save any remaining incomplete data in the buffer
    remainingBuffer = mmsBuffer;
    return remainingBuffer;
  }

  // Save any remaining incomplete data in the buffer
  remainingBuffer = mmsBuffer;
  return remainingBuffer;
}

function sendTitleBrowseResponse(guid, clientID) {
  const items = [
    { guid: guid, name: 'Play Now', type: 'PlayTitle' },
    { guid: guid, name: 'Play Next', type: 'PlayTitle' },
    { guid: guid, name: 'Replace Queue', type: 'PlayTitle' },
    { guid: guid, name: 'Add To Queue', type: 'PlayTitle' },
  ];

  const response = { type: 'browse', items };

  if (clientConnections[clientID] && clientConnections[clientID].ws.readyState === WebSocket.OPEN) {
    clientConnections[clientID].ws.send(JSON.stringify(response));
    console.log(`📤 Sent Title browse response to client ${clientID}:`, response);
  } else {
    console.error(`❌ Unable to send response to client ${clientID}: WebSocket not open.`);
  }
}

function getMappedName(name) {
  if (name.includes('Now')) return 'Now';
  if (name.includes('Next')) return 'Next';
  if (name.includes('Replace')) return 'Replace';
  if (name.includes('Queue')) return 'Append';
  return 'Unknown'; // Default value if no match is found
}

function handleBrowseRequest(data, clientID) {
  const { instance, guid, name, item } = data;
  const clientState = clientConnections[clientID]?.state;
  const clientMmsClient = clientConnections[clientID]?.mmsClient;

  if (!clientState) {
    console.error(`❌ Client state not found for ${clientID}`);
    return;
  }

  if (!instance) {
    console.error(`❌ Missing instance in request from ${clientID}`);
    return;
  }

  const commands = [];
  if (instance !== clientState.currentInstance) {
    clientState.currentInstance = instance;
    commands.push(`SetInstance ${instance}`);
    commands.push(`GetStatus`);
    commands.push(`SubscribeEvents`);
  }

  if (guid) {
    switch (item) {
      case 'PickItem':
        commands.push(`AckPickItem ${guid}`);
        break;
        case 'Album':
          clientState.currentAlbumGuid = guid; // Store the album GUID
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
          // Special case for "Play all"  when 'SetOption supports_playnow=true' is set in init commands sent to MMS
          const playOption = getMappedName(name || 'Now');
          const albumGuid = clientState.currentAlbumGuid || guid; // Use the album GUID from the previous browse menu
          commands.push(`PlayAlbum ${albumGuid} ${playOption}`);
        } else {
          sendTitleBrowseResponse(guid, clientID);
        }
        return;
      case 'PlayTitle':
        const playCommand = getMappedName(name || 'Now');
        commands.push(`PlayTitle ${guid} ${playCommand}`);
        break;
      default:
        commands.push('ClearMusicFilter', 'BrowseTopMenu');
    }
  } else {
    commands.push('ClearMusicFilter', 'BrowseTopMenu');
  }

  commands.forEach((cmd, i) => {
    setTimeout(() => {
      console.log(`[TX] Command for ${clientID}: ${cmd}`);
      clientMmsClient.write(`${cmd}\r\n`);
    }, i * 500);
  });
}

function handleCommandRequest(data, clientID) {
  const { instance, item } = data;
  const clientState = clientConnections[clientID]?.state;
  const clientMmsClient = clientConnections[clientID]?.mmsClient;

  if (!clientState) {
    console.error(`❌ Client state not found for ${clientID}`);
    return;
  }

  if (!item || !instance) {
    console.error(`❌ Missing command or instance in request from ${clientID}`);
    return;
  }

  const commands = [];
  if (instance !== clientState.currentInstance) {
    clientState.currentInstance = instance;
    commands.push(`SetInstance ${instance}`);
    commands.push(`GetStatus`);
    commands.push(`SubscribeEvents`);
  }

  switch (item) {
    case 'Repeat':
      commands.push('Repeat');
      break;
    case 'Rewind':
      commands.push('Rewind');
      break;
    case 'FastForward':
      commands.push('FastForward');
      break;
    case 'Shuffle':
      commands.push('Shuffle');
      break;
    case 'ThumbsUp':
      commands.push('ThumbsUp');
      break;
    case 'ThumbsDown':
      commands.push('ThumbsDown');
      break;
    case 'SkipNext':
      commands.push('SkipNext');
      break;
    case 'SkipPrevious':
      commands.push('SkipPrevious');
      break;
    case 'Play':
      commands.push('Play');
      break;
    case 'Pause':
      commands.push('Pause');
      break;
    case 'PlayPause':
      commands.push('PlayPause');
      break;
    case 'SetVolume':
      const volumeLevel = item.split(' ')[1];
      commands.push(`SetVolume ${volumeLevel}`);
      break;
    case 'Mute':
      const muteCommand = clientState.mute ? 'MUTE OFF' : 'MUTE ON';
      commands.push(muteCommand);
      clientState.mute = !clientState.mute;
      break;
    case 'Seek':
      const seekTime = item.split(' ')[1];
      commands.push(`Seek ${seekTime}`);
      break;
    default:
      commands.push(item);
  }

  ensureMMSConnection(clientID, (clientID) => {
    console.log(`▶️ Command for clientID ${clientID}: ${commands.join(' ➜ ')}`);
    commands.forEach((cmd, i) => {
      setTimeout(() => {
        console.log(`[TX] Data to MMS from client ${clientID}: ${cmd}`);
        clientMmsClient.write(`${cmd}\r\n`);
      }, i * 500);
    });
  });
}

server.listen(3000, () => {
  console.log('✅ MMS Controller running on http://localhost:3000');
});
