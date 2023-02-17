var { SerialPort } = require('serialport')

var path = "0_userdata.0.daly";  //Data path
var usbPath = '/dev/ttyUSB3'; //Usb port
const bySerial = false; //define port by the usb Serial number
const usbSerial = '0107141D';

const port = new SerialPort({
    path: usbPath,
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    autoOpen: false
})  

var timeout = 2000; //
var requestTime = 500;  //INQUIRY INTERVAL: DO NOT CHOOSE TOO SMALL, OTHERWISE A LOT OF DATA WILL BE WRITED

//Search USB port by serial 
SerialPort.list().then(function(ports){
    if (bySerial){
        ports.forEach(function(port){
            console.log(port);
            if (port.serialNumber === usbSerial){
                usbPath = port.path;
                console.log(usbPath);
            }
        });
        port.settings.path = usbPath;
    }
    port.open(function (err) {
        if (err) {
            console.log('Error opening port: ');
            return console.log(err.message);
        }else{
            console.log('Open port succsess: ' + usbPath);
            sendRequest();
        }
    })
});

// close connection if script stopped
onStop(function (callback) {
    port.close(function (err) {
        console.log('port closed', err);
    })
}, 500 /*ms*/);



var HEADER = [0xA5,0x40];
var EMPTY = [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00];

var battCount = 0;
var tempCount = 0;

var lastDataRecived = 0;


// Switches the port into "flowing mode"
port.on('data', function (data) {
    //console.log("New Data");
    var bmsData = [];
    for (const value of data.values()){
        bmsData.push(value);
    }
    //console.log(bmsData);

    var crc = bmsData.pop();
    if (checkData(bmsData,crc)){
        var header = bmsData.shift();
        var address = bmsData.shift();
        var dataId = bmsData.shift();
        var length = bmsData.shift();
        
        switch(dataId) {
            case 0x90:
                if (message_0x90(bmsData)){sendRequest()};
                break;
            case 0x91:
                if (message_0x91(bmsData)){sendRequest()};
                break;
            case 0x92:
                if (message_0x92(bmsData)){sendRequest()};
                break;
            case 0x93:
                if (message_0x93(bmsData)){sendRequest()};
                break;
            case 0x94:
                if (message_0x94(bmsData)){sendRequest()};
                break;
            case 0x95:
                if (message_0x95(bmsData)){sendRequest()};
                break;
            case 0x96:
                if (message_0x96(bmsData)){sendRequest()};
                break;
            case 0x97:
                if (message_0x97(bmsData)){sendRequest()};
                break;
            case 0x98:
                if (message_0x98(bmsData)){sendRequest()};
                break;
            default:
        }

    }
});

var timeoutSend;
var timeoutTimeout;

var message = 0x90;
function sendRequest(){
    clearTimeout(timeoutTimeout);
    timeoutSend = setTimeout(async function () {
        var request = [];

        request = request.concat(HEADER);
        request.push(message);
        request.push(0x08);
        request = request.concat(EMPTY);
        request.push(getChecksum(request));

        //console.log(request);

        const send = Buffer.from(request);
        port.write(send);

        message++;
        if (message > 0x98){
            message = 0x90;
        }
    }, requestTime);

    timeoutTimeout = setTimeout(async function () {
        console.log("Timeout")
        sendRequest();
    }, timeout + requestTime);
}

var arrCS = new Array(120); //Create State
var arrOS = new Array(120); //Old State

function message_0x90(data){ //0x90 SOC of Total Voltage Current
    checkState(0,'volt','Battery voltage','V',Buffer.from(data.slice(0,2)).readInt16BE() / 10);
    checkState(1,'acquisition','acquisition','V',Buffer.from(data.slice(2,4)).readInt16BE() / 10);
    checkState(2,'current','Battery current','A',(Buffer.from(data.slice(4,6)).readInt16BE() - 30000) / 10);
    checkState(3,'soc','Battery SOC','%',Buffer.from(data.slice(6,8)).readInt16BE() / 10);
    return true;
}

function message_0x91(data){ //0x91 Maximum Minimum Voltage of Bms
    checkState(4,'cell.maxVoltage','Max cell voltage','V',Buffer.from(data.slice(0,2)).readInt16BE() / 1000);
    checkState(5,'cell.maxCell','Cell number man voltag','',data[2]);
    checkState(6,'cell.minVoltage','Min cell voltage','V',Buffer.from(data.slice(3,5)).readInt16BE() / 1000);
    checkState(7,'cell.minCell','Cell number min voltage','',data[5]);
    return true;
}


function message_0x92(data){ //0x92 Maximum minimum temperature of Bms    
    checkState(8,'maxTemp','highest temp','°',data[0] - 40);
    checkState(9,'maxTempNo','highest sensor number','',data[1]);
    checkState(10,'minTemp','lowest temp','°',data[2] - 40);
    checkState(11,'minTempNo','highest sensor number','',data[3]);
    return true;
}

function message_0x93(data){ //0x93 Charge/discharge, MOS status
    checkState(12,'chargeDischargeStatus','chargeDischargeStatus','',data[0]);
    checkState(13,'chargingMOS','chargingMOS','',data[1]);
    checkState(14,'dischargeMOS','dischargeMOS','',data[2]);
    checkState(15,'bmsLife','life ticker','',data[3]);
    checkState(16,'capacity','Battery remaining capacity','Ah',Buffer.from(data.slice(4,8)).readInt32BE() / 1000);
    return true;
}


function message_0x94(data){ //0x94 Status Information 1
    battCount = data[0];
    tempCount = data[1];
    checkState(17,'status.cells','cell count','',data[0]);
    checkState(18,'status.tempSensors','tempSensors','',data[1]);
    checkState(19,'status.chargerStatus','chargerStatus','',data[2]);
    checkState(20,'status.loadStatus','loadStatus','',data[3]);
    checkState(21,'status.diDo','state of Di/Dos','',data[4]);
    checkState(22,'status.chargeDischargeCycles','full charge discharge cycle counter','', Buffer.from(data.slice(5,7)).readInt16BE());
    return true;
}

var battVoltages = [];
var battCounter = 1;
var battFramesReceived = 0;

function message_0x95(data){ //0x95 Cell voltage 1~48
    var frameNumber = data[0];
    if (frameNumber === 1 ){
        battVoltages = [];
        battCounter = 1;
        battFramesReceived = 0;
    }
    battFramesReceived++;

    for (var i = 0; i < 3; i++){
        if (battCounter <= battCount){
            battVoltages.push(Buffer.from(data.slice(1 + (i * 2),3 + (i * 2))).readInt16BE() / 1000);
            battCounter++;
        }
    }
    
    if (frameNumber === Math.ceil(battCount / 3) && frameNumber === battFramesReceived){
        for (var i = 0; i < battVoltages.length; i++){
            checkState(23 + i,'cell.cell' + (i + 1),'cell' + (i + 1),'V',battVoltages[i]);
        }
        battVoltages = [];
        battCounter = 1;
        battFramesReceived = 0;
        return true;
    }
    return false;
}

var temperatures = [];
var tempCounter = 1;
var tempFramesReceived = 0;

function message_0x96(data){ //0x96 Bms temperature 1~16
    var frameNumber = data[0];
    if (frameNumber === 1 ){
        temperatures = [];
        tempCounter = 1;
        tempFramesReceived = 0;
    }
    tempFramesReceived++;

    for (var i = 0; i < 7; i++){
        if (tempCounter <= tempCount){
            temperatures.push(data[1 + i] - 40);
            tempCounter++;
        }
    }
    
    if (frameNumber === Math.ceil(tempCount / 7) && frameNumber === tempFramesReceived){
        for (var i = 0; i < temperatures.length; i++){
            checkState(80 + i,'temperature.temp' + (i + 1),'temp' + (i + 1),'°',temperatures[i]);
        }
        temperatures = [];
        tempCounter = 1;
        tempFramesReceived = 0;
        return true;
    }
    return false;
}

function message_0x97(data){ //0x97 Bms balancing state
    checkState(100,'balancing.cell_1_8'   ,'balancing cell state 1-8','',data[0]);
    checkState(101,'balancing.cell_9_16'  ,'balancing cell state 9-16','',data[1]);
    checkState(102,'balancing.cell_17_24' ,'balancing cell state 17-24','',data[2]);
    checkState(103,'balancing.cell_25_32' ,'balancing cell state 25-32','',data[3]);
    checkState(104,'balancing.cell_33_40' ,'balancing cell state 33-40','',data[4]);
    checkState(105,'balancing.cell_41_48' ,'balancing cell state 41-48','',data[5]);
    return true;
}

function message_0x98(data){ //0x98 Battery failure status 0
    checkState(106,'errors.statusByte1'   ,'Status error Byte 1','',data[0]);
    checkState(107,'errors.statusByte2'   ,'Status error Byte 2','',data[1]);
    checkState(108,'errors.statusByte3'   ,'Status error Byte 3','',data[2]);
    checkState(109,'errors.statusByte4'   ,'Status error Byte 4','',data[3]);
    checkState(110,'errors.statusByte5'   ,'Status error Byte 5','',data[4]);
    checkState(111,'errors.statusByte6'   ,'Status error Byte 6','',data[5]);
    checkState(112,'errors.statusByte7'   ,'Status error Byte 7','',data[6]);
    checkState(113,'errors.statusByte8'   ,'Status error Byte 8','',data[7]);
    return true;
}

function checkData(data,crc){
    if (crc === getChecksum(data)){
        //console.log("Data OK");
        return true;
    }
}

function getChecksum(data){
    var checksum = 0;
    for (let i = 0; i < data.length; i++) {
        checksum += data[i]
    }
    return checksum & 0xFF;
}


function checkState(index,pathName,name,unit,data){
    if(arrCS[index] === undefined){
        createState(path + '.' + pathName, data, {
            type: 'number',
            role: 'state',
            name: name,
            unit: unit
        });
        arrCS[index] = true;
        arrOS[index] = data;
    }else{
        if (arrOS[index] != data){
            setState(path + '.' + pathName,data,true);
        }
    }
}







