// load-test.js - Test concurrent WebSocket connections
const WebSocket = require('ws');

class LoadTester {
    constructor(url, options = {}) {
        this.url = url;
        this.concurrentCalls = options.concurrentCalls || 2;
        this.callDuration = options.callDuration || 10000; // 10 seconds
        this.rampUpDelay = options.rampUpDelay || 100; // 100ms between connections

        this.results = {
            attempted: 0,
            connected: 0,
            failed: 0,
            disconnected: 0,
            errors: [],
            connections: new Map()
        };
    }

    async run() {
        console.log(`🚀 Load Test Configuration:`);
        console.log(`   URL: ${this.url}`);
        console.log(`   Concurrent calls: ${this.concurrentCalls}`);
        console.log(`   Call duration: ${this.callDuration}ms`);
        console.log(`   Ramp-up delay: ${this.rampUpDelay}ms\n`);

        const startTime = Date.now();

        // Start connections with ramp-up delay
        for (let i = 0; i < this.concurrentCalls; i++) {
            this.startConnection(i);
            if (i < this.concurrentCalls - 1) {
                await new Promise(resolve => setTimeout(resolve, this.rampUpDelay));
            }
        }

        // Wait for all calls to complete
        await new Promise(resolve => setTimeout(resolve, this.callDuration + 5000));

        // Print results
        this.printResults(Date.now() - startTime);
    }

    startConnection(index) {
        const streamSid = `SM${index}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const connectionStart = Date.now();

        this.results.attempted++;
        console.log(`[${index}] 🔄 Attempting connection (${streamSid})...`);

        const ws = new WebSocket(this.url);
        let isConnected = false;
        let mediaPacketsSent = 0;
        let mediaPacketsReceived = 0;

        // Store connection info
        this.results.connections.set(index, {
            streamSid,
            status: 'connecting',
            startTime: connectionStart,
            ws
        });

        ws.on('open', () => {
            isConnected = true;
            this.results.connected++;
            const connTime = Date.now() - connectionStart;

            console.log(`[${index}] ✅ Connected in ${connTime}ms`);
            this.results.connections.get(index).status = 'connected';
            this.results.connections.get(index).connectionTime = connTime;

            // Send start event
            ws.send(JSON.stringify({
                event: "start",
                start: {
                    streamSid: streamSid,
                    accountSid: "ACtest",
                    callSid: `CA${index}_${Date.now()}`
                }
            }));

            // Send media packets every 20ms
            const mediaInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    const silenceBuffer = Buffer.alloc(160, 0xFF);
                    ws.send(JSON.stringify({
                        event: "media",
                        media: {
                            timestamp: Date.now() - connectionStart,
                            payload: silenceBuffer.toString('base64')
                        }
                    }));
                    mediaPacketsSent++;
                } else {
                    clearInterval(mediaInterval);
                }
            }, 20);

            // Schedule disconnect
            setTimeout(() => {
                clearInterval(mediaInterval);
                if (ws.readyState === WebSocket.OPEN) {
                    console.log(`[${index}] 📴 Closing connection after ${this.callDuration}ms`);
                    ws.close();
                }
            }, this.callDuration);
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.event === 'media') {
                    mediaPacketsReceived++;
                }
            } catch (e) {
                // Ignore parse errors
            }
        });

        ws.on('error', (error) => {
            console.log(`[${index}] ❌ Error: ${error.message}`);
            this.results.errors.push({ index, error: error.message });
            if (!isConnected) {
                this.results.failed++;
                this.results.connections.get(index).status = 'failed';
            }
        });

        ws.on('close', (code, reason) => {
            const conn = this.results.connections.get(index);
            if (isConnected && code !== 1000 && code !== 1001) {
                this.results.disconnected++;
                console.log(`[${index}] 🔴 Unexpected disconnect: code=${code}, reason=${reason}`);
                conn.status = 'disconnected';
                conn.disconnectReason = `${code}: ${reason}`;
            } else if (isConnected) {
                conn.status = 'completed';
            }

            conn.mediaPacketsSent = mediaPacketsSent;
            conn.mediaPacketsReceived = mediaPacketsReceived;
            conn.duration = Date.now() - connectionStart;
        });
    }

    printResults(totalTime) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`📊 LOAD TEST RESULTS`);
        console.log(`${'='.repeat(50)}`);
        console.log(`Total test duration: ${(totalTime / 1000).toFixed(1)}s\n`);

        console.log(`Connection Summary:`);
        console.log(`  Attempted:    ${this.results.attempted}`);
        console.log(`  Connected:    ${this.results.connected} ✅`);
        console.log(`  Failed:       ${this.results.failed} ❌`);
        console.log(`  Disconnected: ${this.results.disconnected} 🔴`);

        if (this.results.connected > 0) {
            console.log(`\nConnection Metrics:`);
            const connTimes = [];
            let totalPacketsSent = 0;
            let totalPacketsReceived = 0;

            this.results.connections.forEach((conn, index) => {
                if (conn.connectionTime) {
                    connTimes.push(conn.connectionTime);
                }
                totalPacketsSent += conn.mediaPacketsSent || 0;
                totalPacketsReceived += conn.mediaPacketsReceived || 0;
            });

            if (connTimes.length > 0) {
                console.log(`  Avg connection time: ${(connTimes.reduce((a, b) => a + b) / connTimes.length).toFixed(0)}ms`);
                console.log(`  Min connection time: ${Math.min(...connTimes)}ms`);
                console.log(`  Max connection time: ${Math.max(...connTimes)}ms`);
            }

            console.log(`\nMedia Packets:`);
            console.log(`  Total sent:     ${totalPacketsSent}`);
            console.log(`  Total received: ${totalPacketsReceived}`);
        }

        if (this.results.errors.length > 0) {
            console.log(`\n❌ Errors:`);
            this.results.errors.forEach(({ index, error }) => {
                console.log(`  [${index}] ${error}`);
            });
        }


        console.log(`\nDetailed Connection Status:`);
        this.results.connections.forEach((conn, index) => {
            console.log(`  [${index}] ${conn.status} - ${conn.streamSid.substr(0, 20)}...`);
            if (conn.disconnectReason) {
                console.log(`       Disconnect reason: ${conn.disconnectReason}`);
            }
        });

        console.log(`\n${'='.repeat(50)}`);

        // Success rate
        const successRate = ((this.results.connected - this.results.disconnected) / this.results.attempted * 100).toFixed(1);
        if (successRate > 50) {
            console.log(`✅ Success Rate: ${successRate}%`);
        } else {
            console.log(`❌ Success Rate: ${successRate}% - CONCURRENCY ISSUE DETECTED!`);
        }
    }
}

// Run the test
if (require.main === module) {
    const url = process.argv[2] || 'wss://piglet-flying-abnormally.ngrok-free.app/call';
    const concurrentCalls = parseInt(process.argv[3]) || 2;
    const duration = parseInt(process.argv[4]) || 10000;

    const tester = new LoadTester(url, {
        concurrentCalls,
        callDuration: duration,
        rampUpDelay: 100
    });

    tester.run().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Test failed:', error);
        process.exit(1);
    });
}

module.exports = LoadTester;