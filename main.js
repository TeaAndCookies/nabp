const WebSocket = require('ws');
const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');
const prompt = require('prompt');
const colors = require("colors/safe");

prompt.message = '';
prompt.delimiter = '';

// websocket server - start

function noop() {
}

function heartbeat() {
    this.isAlive = true;
}

async function startNABP() {
    const wss = new WebSocket.Server({port: 12345});

    wss.on('connection', function connection(ws) {
        ws.isAlive = true;
        ws.on('pong', heartbeat);

        ws.on('message', function (data) {
            const messages = JSON.parse(data);
            for (let message of messages) {
                for (const [key, value] of Object.entries(message)) {
                    handleMessage(ws, key, value);
                }
            }
        });
    });

    const interval = setInterval(function ping() {
        wss.clients.forEach(function each(ws) {
            if (ws.isAlive === false) return ws.terminate();

            ws.isAlive = false;
            ws.ping(noop);
        });
    }, 30000);

    wss.on('close', function close() {
        clearInterval(interval);
    });
}

function sendSerialized(ws, data) {
    ws.send(JSON.stringify(data));
}

// websocket server - done

////////////////////////////////////////////////////////////

// buttplug message handling - start

function handleMessage(ws, type, message) {
    console.log(type, message);

    switch (type) {
        case 'RequestServerInfo':
            sendServerInfo(ws, message.Id);
            break;
        case 'RequestDeviceList':
            sendDeviceList(ws, message.Id);
            break;
        case 'StartScanning':
            sendOk(ws, message.Id);
            break;
        case 'LinearCmd':
            let vector = message.Vectors[0];
            let position = Math.min(Math.max(Math.round(vector.Position * 1000), 0), 999);
            sendTcode('L0' + position + 'I' + vector.Duration);
            sendOk(ws, message.Id);
            break;
        case 'StopDeviceCmd':
            sendTcode('L0500I1000');
            sendOk(ws, message.Id);
            break;
        default:
            console.log('noop');
    }
}

function sendServerInfo(ws, messageId) {
    sendSerialized(
        ws,
        [
            {
                "ServerInfo": {
                    "Id": messageId,
                    "ServerName": "Test Server",
                    "MessageVersion": 2,
                    "MaxPingTime": 0
                }
            }
        ]
    );
}

function sendDeviceList(ws, messageId) {
    sendSerialized(
        ws,
        [
            {
                "DeviceList": {
                    "Id": messageId,
                    "Devices": [
                        {
                            "DeviceName": "TCode device",
                            "DeviceIndex": 0,
                            "DeviceMessages": {
                                "LinearCmd": {"FeatureCount": 1},
                                "StopDeviceCmd": {}
                            }
                        }
                    ]
                }
            }
        ]
    );
}

function sendOk(ws, messageId) {
    sendSerialized(
        ws,
        [
            {
                "Ok": {
                    "Id": messageId
                }
            }
        ]
    );
}

// buttplug message handling - done

////////////////////////////////////////////////////////////

// serial port handling - start

let tcodePort = null;

async function determineSerialPort() {
    await SerialPort.list().then(
        async function (ports) {
            console.log('');
            console.log(colors.bold('Available COM ports:'));
            const portsMap = new Map();
            let i = 0;
            for (let port of ports) {
                i++;
                console.log(colors.bold(' ' + i + ') ') + port.path + colors.gray(' / ') + port.manufacturer + colors.gray(' / ') + (port.serialNumber || '-') + colors.gray(' / ') + port.pnpId);
                portsMap.set(i, port.path);
            }

            console.log('');
            prompt.start();
            const {portIndex} = await prompt.get({
                name: 'portIndex',
                description: colors.white(colors.bold('Which port is TCode device?') + colors.gray(' (1 - ' + i + ')')),
                type: 'number',
                required: true,
                conform: function (value) {
                    return value >= 1 && value <= i;
                }
            });

            tcodePort = new SerialPort(
                portsMap.get(portIndex),
                {baudRate: 115200},
                function (err) {
                    if (err) {
                        console.error('Error opening port: ', err.message);

                        process.exit(1);
                    }
                }
            );
            console.log(tcodePort);

            tcodePort.on('data', function (data) {
                console.log('Data:', Buffer.from(data).toString())
            });

            tcodePort.on('error', function(err) {
                console.log('Error: ', err.message);

                process.exit(1);
            });
        },
        err => console.error(err)
    );
}

function sendTcode(code) {
    console.log('sending TCode: ' + code);

    tcodePort.write(code + '\n', function(err) {
        if (err) {
            return console.log('Error on write: ', err.message)
        }
    });
}

// serial port handling - done

////////////////////////////////////////////////////////////

async function init() {
    await determineSerialPort();

    if (tcodePort === null) {
        console.error('No TCode device available.');

        process.exit(1);
    }

    console.log('Using ' + tcodePort.path + ' port as TCode device.');

    console.log('Starting NABP server.');
    await startNABP();
}

init();