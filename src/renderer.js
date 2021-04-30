const WebSocket = require('ws');
const SerialPort = require('serialport');
const Delimiter = require('@serialport/parser-delimiter')
const log = require('electron-log');
const path = require('path');
const { app } = require('@electron/remote')

log.transports.file.resolvePath = () => path.join(app.getAppPath(), '/main.log');

// elements
const $status = document.getElementById('status');
const $statusPort = document.getElementById('status__port');
const $statusScriptPlayer = document.getElementById('status__script-player');
const $control = document.getElementById('control');
const $controlRangeInput = document.getElementById('control__range__input');
const $controlLabel = document.getElementById('control__label');

// range handler

let rangeTimeout = null;
$controlRangeInput.oninput = function () {
    $controlLabel.innerText = `${this.value} %`;
    let position = Math.min(Math.max(Math.round(parseInt(this.value, 10) * 10), 0), 999);

    if (rangeTimeout !== null) {
        clearTimeout(rangeTimeout);
    }
    rangeTimeout = setTimeout(function () {
        sendTcode(`L0${position}I250`);
    }, 10);
};

function enableRange() {
    $control.classList.remove('disabled');
    $control.removeAttribute('title');
    $controlRangeInput.disabled = false;
}

function disableRange() {
    if ($controlRangeInput.disabled === true) {
        return;
    }

    $control.classList.add('disabled');
    $control.setAttribute('title', $control.dataset.disabledTitle);
    $controlRangeInput.disabled = true;
}

function setRange (value, dispatchInputEvent) {
    var event = new Event('input', {
        bubbles: true,
        cancelable: true,
    });

    $controlRangeInput.value = value;
    if (dispatchInputEvent) {
        $controlRangeInput.dispatchEvent(event);
    }
}

// websocket server - start

function noop() {
}

function heartbeat() {
    this.isAlive = true;
}

async function startWebsocketServer() {
    log.info('Starting websocket server.');

    const wss = new WebSocket.Server({port: 12345});

    wss.on('connection', function connection(ws) {
        ws.isAlive = true;
        ws.on('pong', heartbeat);

        $statusScriptPlayer.textContent = $status.dataset.messageYes;
        $statusScriptPlayer.classList.add('status-line__value--yes');

        ws.on('close', function () {
            $statusScriptPlayer.textContent = $status.dataset.messageNo;
            $statusScriptPlayer.classList.remove('status-line__value--yes');
            enableRange();
        });

        ws.on('message', function (data) {
            for (let message of JSON.parse(data)) {
                for (const [key, value] of Object.entries(message)) {
                    handleMessage(ws, key, value);
                }
            }
        });
    });

    setInterval(function ping() {
        wss.clients.forEach(function each(ws) {
            if (ws.isAlive === false) return ws.terminate();

            ws.isAlive = false;
            ws.ping(noop);
        });
    }, 30000);

    // on websocket server crash, crash the whole app
    wss.on('close', function close() {
        app.quit();
    });
}

function sendSerialized(ws, data) {
    ws.send(JSON.stringify(data));
}

// websocket server - done

////////////////////////////////////////////////////////////

// buttplug message handling - start

function handleMessage(ws, type, message) {
    log.info(type, message);

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
            sendOk(ws, message.Id);

            disableRange();

            let vector = message.Vectors[0];
            let position = Math.min(Math.max(parseFloat(vector.Position), 0), 0.999).toFixed(3).substr(2);
            sendTcode(`L0${position}I${vector.Duration}`);
            break;
        case 'StopDeviceCmd':
            sendOk(ws, message.Id);

            enableRange();
            setRange(50, false);
            sendTcode('L0500I1000');
            break;
        default:
            log.info('noop');
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

function createSerialPort (path) {
    return new SerialPort(
        path,
        {
            baudRate: 115200,
            autoOpen: false,
        }
    );
}

async function isTCodeDevice (port) {
    return new Promise(function (resolve) {
        port.open(function (err) {
            if (err) {
                log.info(`Error opening port ${port.path}: ${err}`);
                resolve(false);

                return;
            }

            log.info(`Port ${port.path} is open.`);

            let timeout = setTimeout(function () {resolve(false)}, 5000);

            const parser = port.pipe(new Delimiter({ delimiter: '\n' }));
            parser.on('data', function (data) {
                log.info(`Port ${port.path} said: ${data}`);

                if (data.includes('TCode')) {
                    clearTimeout(timeout);
                    resolve(true);
                }
            })
        });
    });
}

let tcodePort = null;

function setTCodePort (port) {
    if (tcodePort !== null) {
        log.info(`We already have TCode port at: ${tcodePort.path}`)

        return;
    }

    tcodePort = port;
    log.info(`Setting TCode port to: ${tcodePort.path}`)
    $statusPort.textContent = `${$status.dataset.messageYes} (${tcodePort.path})`;
    $statusPort.classList.add('status-line__value--yes');

    tcodePort.on('close', function (err) {
        log.info(`TCode port ${tcodePort.path} disconnected: ${err}`)
        tcodePort = null;
        $statusPort.textContent = $status.dataset.messageNo;
        $statusPort.classList.remove('status-line__value--yes');
        enableRange();
    });
}

async function determineSerialPort() {
    // discard closed port
    if (tcodePort !== null && ! tcodePort.isOpen) {
        tcodePort = null;
    }

    // only scan if we don't already have a TCode port
    if (tcodePort === null) {
        let list = await SerialPort.list();

        await Promise.all(list.map(async function (item) {
            let port = createSerialPort(item.path);

            const isTCode = await isTCodeDevice(port);

            // we're checking all ports asynchronously, theoretically we could have already found another TCode port
            if (isTCode) {
                setTCodePort(port);

                return;
            }

            port.close(function (err) {
                if (err) {
                    log.info(`Error closing port ${port.path}: ${err}`);
                } else {
                    log.info(`Port ${port.path} is closed.`);
                }
            });
        }));
    }

    // we want to scan ports infinitely
    setTimeout(determineSerialPort, 3000);
}

function sendTcode(code) {
    if (tcodePort === null) {
        return;
    }

    log.info('sending TCode: ' + code);

    tcodePort.write(code + '\n', function(err) {
        if (err) {
            return log.info('Error on write: ', err.message)
        }
    });
}

// serial port handling - done

////////////////////////////////////////////////////////////

startWebsocketServer();
determineSerialPort();