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

let clients = [];
let instanceSockets = {};
let lastInstance = null;
let instanceNames = [];
let nowPlayingByZone = {};

let mmsClient = null;
let mmsConnected = false;
let mmsInitialized = false;
let mmsBuffer = '';
let currentBrowseRes = null;
let currentInstance = null;

function broadcastToClients(data) {
  const msg = JSON.stringify(data);
  Object.values(clientConnections).forEach(({ ws }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
      console.log(`📤 Sent data to client:`, data);
    }
  });
}

function ensureMMSConnection(callback) {
  // Check if the MMS client is already connected
  if (mmsClient && mmsConnected) {
    //console.log('✅ MMS client already connected.');
    if (callback) callback(); // Execute the callback if provided
    return;
  }

  // Initialize the MMS client if not connected
  initializeMMSClient();

  // Wait for the connection to be established before executing the callback
  const interval = setInterval(() => {
    console.log('✅ ensureMMSConnection Waiting for MMS client to connected.');
    if (mmsConnected) {
      clearInterval(interval); // Stop checking once connected
      if (callback) callback(); // Execute the callback
    }
  }, 100); // Check every 100ms
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
  console.log(`📥 Extracted <Instances> XML:`, cleanXml); // Debugging log

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

      console.log(`✅ Parsed Instances:`, instances); // Debugging log
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
  if (firstTag > 0) xml = xml.slice(firstTag);
  const result = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const rootKey = Object.keys(result)[0];
  const root = result[rootKey];
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

  const rawItems = root[childTag];
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items.map(item => {
    const attrs = item.$ || item;
    return {
      guid: attrs.guid || attrs.id,
      name: attrs.name || attrs.title || 'Unnamed',
      type: childTag,
      hasChildren: attrs.hasChildren === '1',
      hasArt: attrs.hasArt === '1',
      browseAction: attrs.browseAction || null
    };
  });
}

function initializeMMSClient() {
  if (mmsClient && mmsConnected) {
    console.log('✅ MMS client already connected.');
    return;
  }

  console.log('🔌 Initializing MMS client...');
  mmsClient = new net.Socket();

  mmsClient.connect(MMS_PORT, MMS_IP, () => {
    console.log('🔌 Connected to MMS server');
    mmsConnected = true;
  });

  let mmsBuffer = '';
  let timeoutHandle = null;

  mmsClient.on('data', async (data) => {
    mmsBuffer += data.toString();
    console.log(`[RX] Data from MMS: ${data.toString()}`);

    // Clear any existing timeout
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    // Set a timeout to handle cases where data is incomplete
    timeoutHandle = setTimeout(() => {
      console.error('❌ Timeout waiting for complete data. Clearing buffer:', mmsBuffer);
      console.log('🔌 MMS client connected:', mmsClient && !mmsClient.destroyed);
      mmsBuffer = ''; // Clear the buffer
    }, 30000); // 30 seconds timeout

    // Process the buffer
    mmsBuffer = await processMMSBuffer(mmsBuffer, timeoutHandle);
  });

  mmsClient.on('error', (err) => {
    console.error('❌ MMS connection error:', err.message);
    mmsConnected = false;
    mmsClient.destroy();
    mmsClient = null;
  });

  mmsClient.on('close', () => {
    console.log('🔌 MMS connection closed');
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

  return {
    instance: getMatch(/InstanceName=([^\n\r]*)/, 'None'),
    baseWebUrl: getMatch(/BaseWebUrl=([^\n\r]*)/, MMS_IP),
    playState: getMatch(/PlayState=([^\n\r]*)/, 'Stopped'),
    trackName: getMatch(/TrackName=([^\n\r]*)/, ''),
    artistName: getMatch(/ArtistName=([^\n\r]*)/, ''),
    albumName: getMatch(/MediaName=([^\n\r]*)/, ''),
    trackDuration: getInt(/TrackDuration=(\d+)/),
    trackTime: getInt(/TrackTime=(\d+)/),
    nowPlayingGuid: getMatch(/NowPlayingGuid=\{([a-f0-9\-]{36})\}/i, '00000000-0000-0000-0000-000000000000'),
  };
}

function processGetStatusBuffer(buffer) {
  // Remove unnecessary newlines that are not before ReportState or StateChanged
  const cleanedBuffer = buffer.replace(/(?<!ReportState|StateChanged)\n/g, ' ');

  // Split the cleaned buffer into lines
  const lines = cleanedBuffer.split('\n').map(line => line.trim()).filter(Boolean);

  // Filter out lines that do not start with "ReportState" or "StateChanged"
  const relevantLines = lines.filter(line => line.startsWith('ReportState') || line.startsWith('StateChanged'));

  // Join the relevant lines back into a single string for parsing
  const parsedBuffer = relevantLines.join('\n');

  // Parse the lines into a structured JSON object
  const instance = extractInstance(parsedBuffer);
  const parsedData = parseGetStatus(parsedBuffer);

  // Send the parsed data as a single JSON message
  broadcastToClients({ type: 'getStatus', instance, data: parsedData });
  console.log(`📤 Sent GetStatus data to clients:`, parsedData);
}

/* Working Version

async function processMMSBuffer(mmsBuffer, timeoutHandle) {
  let getStatusBuffer = ''; // Buffer for GetStatus responses
  let isProcessingGetStatus = false; // Flag to indicate GetStatus processing
  let remainingBuffer = ''; // To store unprocessed or incomplete lines

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
      const xmlBlock = mmsBuffer.slice(0, xmlEndIndex + closingTags.find((tag) => mmsBuffer.includes(tag)).length);
      mmsBuffer = mmsBuffer.slice(xmlEndIndex + closingTags.find((tag) => mmsBuffer.includes(tag)).length).trimStart();

      try {
        const parsed = await parseXlm(xmlBlock);
        if (parsed.type === 'instances') {
          broadcastToClients({ type: 'instances', instances: parsed.data });
        } else if (parsed.type === 'browse') {
          broadcastToClients({ type: 'browse', items: parsed.data });
        } else {
          broadcastToClients({ type: 'xml', data: parsed.data });
        }

        // Clear the timeout after processing
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      } catch (err) {
        console.error('❌ Error parsing XML:', err);
      }
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
      processGetStatusBuffer(getStatusBuffer);

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
        const stateChangedMatch = command.match(/^StateChanged\s+(\S+)\s+(.+)$/);
        if (stateChangedMatch) {
          const instance = stateChangedMatch[1]; // Extract the instance
          const stateData = stateChangedMatch[2]; // Extract the full value string

          // Parse state data into key-value pairs
          const events = {};
          const keyValuePairs = stateData.match(/(\w+=[^=]+(?:\s[^=\s]+)*|[^=\s]+=[^=\s]+)/g);
          if (keyValuePairs) {
            keyValuePairs.forEach((pair) => {
              const [key, ...valueParts] = pair.split('=');
              const value = valueParts.join('=').trim(); // Rejoin in case the value contains '=' or spaces
              events[key] = value;
            });
          }

          console.log(`📤 StateChanged event for instance ${instance}:`, events);
          broadcastToClients({ type: 'stateChanged', instance, events });

          // Clear the timeout after processing
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }

          continue; // Process the next line
        }
      }

      // Match key-value pairs (e.g., "SubscribeEvents True")
      const keyValueMatch = command.match(/^(\w+)\s+(.+)$/);
      if (keyValueMatch) {
        const key = keyValueMatch[1];
        const value = keyValueMatch[2];
        broadcastToClients({ type: 'keyValue', key, value });

        // Clear the timeout after processing
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        continue; // Process the next line
      }

      // Handle unrecognized data
      console.log(`❓ Unhandled data: "${command}"`);
    }

    // Save any remaining incomplete data in the buffer
    remainingBuffer = mmsBuffer;
    return remainingBuffer;
  }

  // Save any remaining incomplete data in the buffer
  remainingBuffer = mmsBuffer;
  return remainingBuffer;
}
 */

async function processMMSBuffer(mmsBuffer, timeoutHandle) {
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
        const parsed = await parseXlm(xmlBuffer);
        if (parsed.type === 'instances') {
          broadcastToClients({ type: 'instances', instances: parsed.data });
        } else if (parsed.type === 'browse') {
          broadcastToClients({ type: 'browse', items: parsed.data });
        } else {
          broadcastToClients({ type: 'xml', data: parsed.data });
        }

        // Clear the timeout after processing
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        xmlBuffer = ''; // Clear the XML buffer after successful parsing
      } catch (err) {
        console.error('❌ Error parsing XML:', err);
      }
    } else {
      // If the XML is incomplete, accumulate it in the XML buffer
      xmlBuffer += mmsBuffer;
    
      // Log the current state of the buffer for debugging
      console.log('Accumulating incomplete XML data:', xmlBuffer);
    
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
      processGetStatusBuffer(getStatusBuffer);

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
        const stateChangedMatch = command.match(/^StateChanged\s+(\S+)\s+(.+)$/);
        if (stateChangedMatch) {
          const instance = stateChangedMatch[1]; // Extract the instance
          const stateData = stateChangedMatch[2]; // Extract the full value string

          // Parse state data into key-value pairs
          const events = {};
          const keyValuePairs = stateData.match(/(\w+=[^=]+(?:\s[^=\s]+)*|[^=\s]+=[^=\s]+)/g);
          if (keyValuePairs) {
            keyValuePairs.forEach((pair) => {
              const [key, ...valueParts] = pair.split('=');
              const value = valueParts.join('=').trim(); // Rejoin in case the value contains '=' or spaces
              events[key] = value;
            });
          }

          console.log(`📤 StateChanged event for instance ${instance}:`, events);
          broadcastToClients({ type: 'stateChanged', instance, events });

          // Clear the timeout after processing
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }

          continue; // Process the next line
        }
      }

      // Match key-value pairs (e.g., "SubscribeEvents True")
      const keyValueMatch = command.match(/^(\w+)\s+(.+)$/);
      if (keyValueMatch) {
        const key = keyValueMatch[1];
        const value = keyValueMatch[2];
        broadcastToClients({ type: 'keyValue', key, value });

        // Clear the timeout after processing
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        continue; // Process the next line
      }

      // Handle unrecognized data
      console.log(`❓ Unhandled data: "${command}"`);
    }

    // Save any remaining incomplete data in the buffer
    remainingBuffer = mmsBuffer;
    return remainingBuffer;
  }

  // Save any remaining incomplete data in the buffer
  remainingBuffer = mmsBuffer;
  return remainingBuffer;
}


wss.on('connection', (ws, req) => {
  const clientID = new URLSearchParams(req.url.split('?')[1]).get('clientID');
  if (!clientID) {
    console.error('❌ Missing clientID, closing connection.');
    ws.close();
    return;
  }

  console.log(`🌐 WebSocket client connected: ${clientID}`);
  clientConnections[clientID] = { ws, data: [] }; // Track WebSocket and data for clientID

  // Send initialization commands to MMS
  const initCommands = [
    'SetClientType DemoClient',
    'SetClientVersion 1.0.0.0',
    'SetOption supports_playnow=true',
    'SetOption supports_inputbox=true',
    'SetOption supports_urls=true',
    `SetHost ${MMS_IP}`,
    'SetXmlMode Lists',
    'SetEncoding 65001',
    'SetPickListCount 100000',
    'BrowseInstances',
  ];

  ensureMMSConnection(() => {
    console.log(`▶️ Sending initialization commands for clientID ${clientID}...`);
    initCommands.forEach((cmd, i) => {
      setTimeout(() => {
        console.log(`[TX] Initialization for ${clientID}: ${cmd}`);
        mmsClient.write(`${cmd}\r\n`);
      }, i * 250);
    });
  });

  ws.on('message', (message) => {
    try {
      // Decode the message buffer into a string
      const decodedMessage = message.toString();

      // Attempt to parse the message as JSON
      const data = JSON.parse(decodedMessage);

      console.log(`📩 Message from ${clientID}:`, JSON.stringify(data, null, 2)); // Pretty-print JSON

      if (data.type === 'browse') {
        handleBrowseRequest(data, clientID);
      } else if (data.type === 'command') {
        handleCommandRequest(data, clientID);
      } else {
        console.warn(`❓ Unknown message type from ${clientID}:`, data.type);
      }
    } catch (err) {
      // If the message is not JSON, log it as a string
      console.error(`❌ Error processing message from ${clientID}:`, err.message);
      console.log(`📩 Raw message from ${clientID}:`, message.toString());
    }
  });

  ws.on('close', () => {
    console.log(`❌ WebSocket client disconnected: ${clientID}`);
    delete clientConnections[clientID];
    currentInstance = null;
  });
});

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

  if (!instance) {
    console.error(`❌ Missing instance in request from ${clientID}`);
    return;
  }

  const commands = [];
  if (instance !== currentInstance) {
    currentInstance = instance;
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
        sendTitleBrowseResponse(guid, clientID);
        return; // No need to send commands to MMS for Title
      case 'PlayTitle':
        const playCommand = getMappedName(name || 'Now');
        commands.push(`PlayTitle ${guid} ${playCommand}`);
        commands.push('ClearMusicFilter', 'BrowseTopMenu');
        break;
      default:
        commands.push('ClearMusicFilter', 'BrowseTopMenu');
    }
  } else {
    commands.push('ClearMusicFilter', 'BrowseTopMenu');
  }



  ensureMMSConnection(() => {
    console.log(`▶️ Browse commands for clientID ${clientID}: ${commands.join(' ➜ ')}`);
    commands.forEach((cmd, i) => {
      setTimeout(() => {
        console.log('[TX]', cmd);
        mmsClient.write(`${cmd}\r\n`);
      }, i * 500);
    });
  });
}

function handleCommandRequest(data, clientID) {
  const { instance, item } = data;

  if (!item || !instance) {
    console.error(`❌ Missing command or instance in request from ${clientID}`);
    return;
  }

  const commands = [];
  if (instance !== currentInstance) {
    currentInstance = instance;
    commands.push(`SetInstance ${instance}`);
    commands.push(`GetStatus`);
    commands.push(`SubscribeEvents`);
  }

  commands.push(item);

  ensureMMSConnection(() => {
    console.log(`▶️ Command for clientID ${clientID}: ${commands.join(' ➜ ')}`);
    commands.forEach((cmd, i) => {
      setTimeout(() => {
        console.log('[TX]', cmd);
        mmsClient.write(`${cmd}\r\n`);
      }, i * 500);
    });
  });
}

server.listen(3000, () => {
  console.log('✅ MMS Controller running on http://localhost:3000');
});
