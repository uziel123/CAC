#!/usr/bin/env node
'use strict';

//const iobrokerCmd  = 'node C:\\Users\\USuser\\iobroker\\node_modules\\iobroker.js-controller\\iobroker.js'; // change this command it differs for you system
const iobrokerCmd  = 'iobroker'; // change this command it differs for you system
//const iobrokerCmd  = 'node /opt/iobroker/node_modules/iobroker.js-controller/iobroker.js'; // change this command it differs for you system

const fs       = require('fs');
const readline = require('readline');
const exec     = require('child_process').exec;
const https    = require('https');
const url      = require('url');

const licenseURL   = 'https://iobroker.pro:450/license';

let vendorName;
let vendorPrefix;

// 1. Generate UUID for this device
// 2. Upload iob-vendor.json file
// 3. Get vis license
// 4. Save vis license

// Just print the prompt and get the answer
function getValueFromCli(prompt) {
    return new Promise(resolve => {

        const rl = readline.createInterface({
            input:  process.stdin,
            output: process.stdout
        });

        rl.question(prompt, answer => {
            rl.close();
            resolve(answer);
        });

    });
}

function execute(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                return reject(err);
            }
            resolve(stdout);
        });
    });
}

function post(user, pass, data) {
    data = data || {};
    if (typeof data === 'object') {
        data = JSON.stringify(data);
    }

    const myURL = url.parse(licenseURL);

    // An object of options to indicate where to post to
    const options = {
        host: myURL.hostname,
        port: myURL.port,
        path: myURL. path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'Authorization': 'Basic ' + new Buffer(user + ':' + pass).toString('base64')
        }
    };

    return new Promise((resolve, reject) => {
        let answer = '';
        // Set up the request
        let postReq = https.request(options, res => {
            res.setEncoding('utf8');
            res.on('data', chunk => {
                answer += chunk.toString('utf8');
            });
            res.on('end', () => {
                try {
                    answer = JSON.parse(answer);
                } catch (e) {
                    return reject(`Cannot parse answer: ${answer}`);
                }

                resolve(answer);
            });
        });

        console.log('SEND POST: ' + data);
        // post the data
        postReq.write(data);
        postReq.end();
    });
}

function requestWebLicense(vendor, password, license, uuid, datapoints) {
    return post(vendor, password, {
        name:       license,
        datapoints: datapoints,
        vendor:     vendor,
        deviceUuid: uuid
    });
}

function getVendorFile() {
    if (fs.existsSync('./iob-vendor.json')) {
        return Promise.resolve('./iob-vendor.json');
    } else if (fs.existsSync('/etc/iob-vendor.json')) {
        return Promise.resolve('/etc/iob-vendor.json');
    } else {
        return getValueFromCli(`Enter path to iob-vendor.json file: `).then(file => {
            if (!fs.existsSync(file)) {
                return getValueFromCli(`File ${file} does not exist, try one more time: `).then(file => {
                    if (!fs.existsSync(file)) {
                        return Promise.reject(`File ${file} not found!`);
                    } else {
                        return Promise.resolve(file);
                    }
                })
            } else {
                return file;
            }
        });
    }
}

function getMac() {
    const macRegex  = /(?:[a-z0-9]{2}[:\-]){5}[a-z0-9]{2}/ig;
    const zeroRegex = /(?:[0]{2}[:\-]){5}[0]{2}/;
    const command   = (process.platform.indexOf('win') === 0) ? 'getmac' : 'ifconfig || ip link';

    return execute(command).then(stdout => {
        let macAddress;
        let match;
        let result = null;

        while (match = macRegex.execute(stdout)) {
            macAddress = match[0];
            if (!zeroRegex.test(macAddress) && !result) result = macAddress;
        }

        if (result === null) {
            callback(new Error('could not determine the mac address from:\n' + stdout));
        } else {
            callback(null, result.replace(/-/g, ':').toLowerCase());
        }
    });
}

// Build unique uuid based on MAC address if possible
// taken from tools.js
function uuid(mac) {
    let u;

    if (!mac && mac !== null) {
        const ifaces = require('os').networkInterfaces();

        // Find first not empty MAC
        for (let n in ifaces) {
            if (!ifaces.hasOwnProperty(n)) continue;
            for (let c = 0; c < ifaces[n].length; c++) {
                if (ifaces[n][c].mac && ifaces[n][c].mac !== '00:00:00:00:00:00') {
                    mac = ifaces[n][c].mac;
                    break;
                }
            }
            if (mac) break;
        }
    }

    if (mac === undefined) {
        return getMac().then(mac => uuid(mac || null));
    }

    if (mac) {
        const md5sum = require('crypto').createHash('md5');
        md5sum.update(mac);
        mac = md5sum.digest('hex');
        u = mac.substring(0, 8) + '-' + mac.substring(8, 12) + '-' + mac.substring(12, 16) + '-' + mac.substring(16, 20) + '-' + mac.substring(20);
    } else {
        // Returns a RFC4122 compliant v4 UUID https://gist.github.com/LeverOne/1308368 (DO WTF YOU WANT TO PUBLIC LICENSE)
        let a;
        let b;
        b = a = '';
        while (a++ < 36) {
            b += ((a * 51) & 52) ? (a ^ 15 ? 8 ^ Math.random() * (a ^ 20 ? 16 : 4) : 4).toString(16) : '-';
        }
        u = b;
    }

    // todo => delete it after the vendor works 2018.03.28 BF
    u = vendorPrefix + u;
    u = u.replace('\n', '');
    return Promise.resolve(u);
}

function addUuid(file) {
    return uuid().then(id => {
        let vendorData = JSON.parse(fs.readFileSync(file).toString('utf8'));
        vendorData.uuid = id;
        console.log(`Generated UUID: ${id}`);
        fs.writeFileSync(file, JSON.stringify(vendorData, null, 2));
        return id;
    });
}

let gVendorDataPassword;
let gVendorWebPassword;
let gVendorFile;
let gVendorDatapoints;
let gVendorUUID;

function doIt() {
    getVendorFile()
        .then(file => {
            gVendorFile = file;
            let vendorData = JSON.parse(fs.readFileSync(file).toString('utf8'));
            vendorName = vendorData.vendor.id;
            vendorPrefix = vendorData.vendor.uuidPrefix;
            return addUuid(file);
        })
        .then(() => getValueFromCli('Please enter vendor password for vendor lock (not web account password!): '))
        .then(password => {
            if (!password) {
                return Promise.reject('Password cannot be empty!');
            }
            gVendorDataPassword = password;
        })
        .then(() => getVendorFile())
        .then(file => {
            gVendorFile = file;
            return addUuid(file);
        })
        .then(_uuid => {
            gVendorUUID = _uuid;
            return execute(`${iobrokerCmd} vendor ${gVendorDataPassword} ${gVendorFile}`);
        })
        // request licenses from
        .then(output => {
            console.log(`After vendor file: ${output}`);
            return getValueFromCli(`Do you want request vis license, if yes enter your web password for "${vendorName}": `)
        })
        .then(password => {
            gVendorWebPassword = password;
			if (password) {			
				return getValueFromCli('Enter number of datapoints: ');
			} else {
				return 0;
			}
        })
        .then(datapoints => {
			gVendorDatapoints = datapoints;
			return execute(`${iobrokerCmd} uuid`);
        })
        .then(uuid => {
            if (!uuid) {
                return Promise.reject('Cannot read uuid of device!');
            }
            uuid = uuid.replace('\n', '');
			if (gVendorWebPassword) {				
				return requestWebLicense(vendorName, gVendorWebPassword, 'iobroker.vis', uuid, gVendorDatapoints);
			} else {
				return '';
			}
        })
        .then(visLicense => {
			if (visLicense) {		
				console.log(JSON.stringify(visLicense, null, 2));

				if (!visLicense || !visLicense.license) {
					return Promise.reject('Something goes wrong by getting the license');
				} else if (visLicense.error) {
					return Promise.reject(`Something goes wrong by getting the license: ${visLicense.error}`);
				}
				return execute(`${iobrokerCmd} license ${visLicense.license}`);
			} else {
				return '';
			}
        })
		.then(output => {
			console.log(output);
			// setup the npm registry
			let json = JSON.parse(fs.readFileSync(gVendorFile).toString('utf-8'));
			
			let link = json.objects['system.repositories'].native.repositories.default.link;
			// http://35.202.189.0:5081/sources-dist-stable.json
			link = link.replace('sources-dist-stable.json', '');
			link = link.replace('5081', '5080');
			return execute('npm set registry ' + link);
		})
        .then(output => {			
            console.log(output);
            process.exit();
        })
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
doIt();