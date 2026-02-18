/**
 * Health Check & Proxy Server for OpenClaw Gateway on Railway
 * 
 * This server:
 * - Responds to /health for Railway health checks
 * - Provides device management API for pairing
 * - Proxies all other requests to the internal OpenClaw gateway
 */

const http = require('http');
const url = require('url');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const PORT = process.env.PORT || 8080;
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18789;
const GATEWAY_HOST = '127.0.0.1';

console.log(`Health & Proxy server configuration:`);
console.log(`  Public port: ${PORT}`);
console.log(`  Gateway: http://${GATEWAY_HOST}:${GATEWAY_PORT}`);

// Parse openclaw devices list output into structured JSON
function parseDevicesOutput(output) {
    const devices = [];
    const lines = output.trim().split('\n');
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        // Parse device info from CLI output
        // Format varies, but typically includes requestId and status
        const pendingMatch = line.match(/pending.*?([a-f0-9]{12,})/i);
        const approvedMatch = line.match(/approved.*?([a-f0-9]{12,})/i) || line.match(/paired.*?([a-f0-9]{12,})/i);
        
        if (pendingMatch) {
            devices.push({
                requestId: pendingMatch[1],
                status: 'pending',
                info: line.trim(),
                timestamp: new Date().toISOString()
            });
        } else if (approvedMatch) {
            devices.push({
                requestId: approvedMatch[1],
                status: 'approved',
                info: line.trim(),
                timestamp: new Date().toISOString()
            });
        } else if (line.includes('request') || line.includes('device')) {
            // Generic device entry
            const idMatch = line.match(/([a-f0-9]{12,})/i);
            if (idMatch) {
                devices.push({
                    requestId: idMatch[1],
                    status: line.toLowerCase().includes('pending') ? 'pending' : 'approved',
                    info: line.trim(),
                    timestamp: new Date().toISOString()
                });
            }
        }
    }
    
    return devices;
}

// List all devices (pending and approved)
async function listDevices() {
    try {
        const { stdout, stderr } = await execAsync('openclaw devices list', {
            cwd: process.env.OPENCLAW_WORKSPACE || '/data/workspace',
            timeout: 10000
        });
        
        if (stderr && !stdout) {
            throw new Error(stderr);
        }
        
        const devices = parseDevicesOutput(stdout);
        return { success: true, devices };
    } catch (error) {
        console.error('Error listing devices:', error.message);
        return { 
            success: false, 
            error: error.message,
            devices: []
        };
    }
}

// Approve a device by requestId
async function approveDevice(requestId) {
    try {
        const { stdout, stderr } = await execAsync(`openclaw devices approve ${requestId}`, {
            cwd: process.env.OPENCLAW_WORKSPACE || '/data/workspace',
            timeout: 10000
        });
        
        return { 
            success: true, 
            message: `Device ${requestId} approved`,
            output: stdout
        };
    } catch (error) {
        console.error('Error approving device:', error.message);
        return { 
            success: false, 
            error: error.message
        };
    }
}

// Helper to send JSON response with CORS headers
function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

// Helper to read request body
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

// Create the proxy server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url);
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }
    
    // Device management API endpoints
    if (parsedUrl.pathname === '/api/devices' && req.method === 'GET') {
        console.log('Listing devices...');
        const result = await listDevices();
        sendJSON(res, 200, result);
        return;
    }
    
    if (parsedUrl.pathname === '/api/devices/approve' && req.method === 'POST') {
        try {
            const body = await readRequestBody(req);
            const { requestId } = body;
            
            if (!requestId) {
                sendJSON(res, 400, { success: false, error: 'requestId required' });
                return;
            }
            
            console.log(`Approving device: ${requestId}`);
            const result = await approveDevice(requestId);
            sendJSON(res, result.success ? 200 : 500, result);
        } catch (error) {
            console.error('Error processing approve request:', error);
            sendJSON(res, 400, { success: false, error: error.message });
        }
        return;
    }
    
    // Health check endpoint
    if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            gateway: `http://${GATEWAY_HOST}:${GATEWAY_PORT}`
        }));
        return;
    }
    
    // Proxy all other requests to OpenClaw gateway
    const proxyOptions = {
        hostname: GATEWAY_HOST,
        port: GATEWAY_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers
    };
    
    // Remove host header to avoid conflicts
    delete proxyOptions.headers.host;
    
    const proxyReq = http.request(proxyOptions, (proxyRes) => {
        // Forward status code and headers
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        
        // Pipe the response body
        proxyRes.pipe(res, { end: true });
    });
    
    // Handle proxy errors
    proxyReq.on('error', (err) => {
        console.error(`Proxy error: ${err.message}`);
        
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Gateway unavailable',
                message: err.message,
                hint: 'OpenClaw gateway may still be starting up'
            }));
        }
    });
    
    // Handle client errors
    req.on('error', (err) => {
        console.error(`Request error: ${err.message}`);
        proxyReq.destroy();
    });
    
    // Pipe the request body to the proxy
    req.pipe(proxyReq, { end: true });
});

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
    const parsedUrl = url.parse(req.url);
    
    // Don't proxy health check upgrades
    if (parsedUrl.pathname === '/health') {
        socket.destroy();
        return;
    }
    
    // Proxy WebSocket upgrade to gateway
    const proxyReq = http.request({
        hostname: GATEWAY_HOST,
        port: GATEWAY_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers
    });
    
    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        socket.write(`HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`);
        
        Object.keys(proxyRes.headers).forEach(key => {
            socket.write(`${key}: ${proxyRes.headers[key]}\r\n`);
        });
        
        socket.write('\r\n');
        socket.write(proxyHead);
        
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
    });
    
    proxyReq.on('error', (err) => {
        console.error(`WebSocket proxy error: ${err.message}`);
        socket.destroy();
    });
    
    proxyReq.end();
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✓ Server listening on 0.0.0.0:${PORT}`);
    console.log(`✓ Device management API:`);
    console.log(`  GET  /api/devices - List all devices`);
    console.log(`  POST /api/devices/approve - Approve device`);
    console.log(`✓ Health check available at http://0.0.0.0:${PORT}/health`);
    console.log(`✓ Proxying requests to http://${GATEWAY_HOST}:${GATEWAY_PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
