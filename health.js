/**
 * Health Check & Proxy Server for OpenClaw Gateway on Railway
 * 
 * This server:
 * - Responds to /health for Railway health checks
 * - Proxies all other requests to the internal OpenClaw gateway
 */

const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 8080;
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18789;
const GATEWAY_HOST = '127.0.0.1';

console.log(`Health & Proxy server configuration:`);
console.log(`  Public port: ${PORT}`);
console.log(`  Gateway: http://${GATEWAY_HOST}:${GATEWAY_PORT}`);

// Create the proxy server
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url);
    
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
