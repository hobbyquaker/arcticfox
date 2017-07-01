const events = require('events');
const binary = require('binary');
const HID = require('node-hid');

class ArcticFox extends events.EventEmitter {
    constructor() {
        super();

        this.hid = null;
        this.connected = false;
        this.reconnectTimeout = 1000;
        this.callbackTimeout = 1000;

        this.vendorId = 0x0416;
        this.productId = 0x5020;
        this.dataflashLength = 2048;
        this.configurationLength = 1088;
        this.monitoringDataLength = 64;
        this.logoOffset = 102400;
        this.logoLength = 1024;

        this.commands = {
            readDataflash: 0x35,
            writeDataflash: 0x53,
            resetDataflash: 0x7C,

            writeData: 0xC3,
            restart: 0xB4,

            screenshot: 0xC1,

            readMonitoringData: 0x66,
            puff: 0x44,

            readConfiguration: 0x60,
            writeConfiguration: 0x61,
            setDateTime: 0x64,

            setLogo: 0xA5
        };
    }

    connect() {
        try {
            this.hid = new HID.HID(this.vendorId, this.productId);
            let message = Buffer.from([]);
            this.hid.on('data', data => {
                clearTimeout(this.timeout);
                switch (this.expectedAnswer) {
                    case 'monitoringData':
                        if (this.callback) {
                            this.callback(null, this.parseMonitoringData(data));
                            this.callback = null;
                        }
                        break;
                    case 'configuration':
                        if (this.callback) {
                            message = Buffer.concat([message, data]);
                            if (message.length >= this.configurationLength) {
                                this.callback(null, this.parseConfiguration(message));
                                this.callback = null;
                            }
                        }
                        break;
                    case 'screenshot':
                        if (this.callback) {
                            message = Buffer.concat([message, data]);
                            if (message.length >= 0x400) {
                                this.callback(null, message);
                                this.callback = null;
                            }
                        }
                    default:
                }
            });
            this.hid.on('error', err => {
                this.emit('error', err);
                // This.disconnect();
            });
            this.connected = true;
            this.emit('connect');
        } catch (err) {
            this.disconnect();
            return;
        }


    }

    disconnect() {
        if (this.connected) {
            this.connected = false;
            this.emit('close');
        }
        setTimeout(() => {
            this.connect();
        }, this.reconnectTimeout);
    }

    createCommand(commandCode, arg1, arg2) {
        // See https://github.com/TBXin/NFirmwareEditor/blob/master/src/NCore/USB/HidConnector.cs#L324
        let arr = [
            commandCode,

            14,

            arg1 & 0xFF,
            (arg1 & 0xFF00) >> 8,
            (arg1 & 0xFF0000) >> 16,
            (arg1 & 0xFF000000) >> 24,

            arg2 & 0xFF,
            (arg2 & 0xFF00) >> 8,
            (arg2 & 0xFF0000) >> 16,
            (arg2 & 0xFF000000) >> 24,

            'H'.charCodeAt(0),
            'I'.charCodeAt(0),
            'D'.charCodeAt(0),
            'C'.charCodeAt(0)
        ];

        let sum = 0;
        arr.forEach(elem => {
            sum += elem;
        });
        while (sum > 0) {
            arr.push(sum & 0xFF);
            sum >>= 8;
        }

        return arr;
    }

    hidWrite(data) {
        try {
            this.hid.write(data);
            return true;
        } catch (err) {
            this.emit('error', err);
            this.disconnect();
            return false;
        }
    }

    parseMonitoringData(buf) {
        // See https://github.com/TBXin/NFirmwareEditor/blob/master/src/NToolbox/Models/MonitoringData.cs

        const data = binary.parse(buf)
            .word32lu('Timestamp')
            .word8lu('IsFiring')
            .word8lu('IsCharging')
            .word8lu('IsCelcius')
            .word8lu('Battery1Voltage')
            .word8lu('Battery2Voltage')
            .word8lu('Battery3Voltage')
            .word8lu('Battery4Voltage')
            .word16lu('PowerSet')
            .word16lu('TemperatureSet')
            .word16lu('Temperature')
            .word16lu('OutputVoltage')
            .word16lu('OutputCurrent')
            .word16lu('Resistance')
            .word16lu('RealResistance')
            .word8lu('BoardTemperature')
            .vars;

        data.IsFiring = Boolean(data.IsFiring);
        data.IsCharging = Boolean(data.IsCharging);
        data.IsCelcius = Boolean(data.IsCelcius);

        data.Battery1Voltage = data.Battery1Voltage ? ((data.Battery1Voltage + 275) / 100) : 0;
        data.Battery2Voltage = data.Battery2Voltage ? ((data.Battery2Voltage + 275) / 100) : 0;
        data.Battery3Voltage = data.Battery3Voltage ? ((data.Battery3Voltage + 275) / 100) : 0;
        data.Battery4Voltage = data.Battery4Voltage ? ((data.Battery4Voltage + 275) / 100) : 0;

        data.PowerSet /= 10;

        data.OutputVoltage /= 100;
        data.OutputCurrent /= 100;
        data.OutputPower = parseFloat((data.OutputVoltage * data.OutputCurrent).toFixed(2));

        data.Resistance /= 1000;
        data.RealResistance /= 1000;

        return data;
    }

    parseProfile(buf) {
        const data = binary.parse(buf)
            .buffer('Name', 8)
            .word8('Flags')
            .word8('PreheatType')
            .word8('SelectedCurve')
            .word8('PreheatTime')
            .word8('PreheatDelay')
            .word16lu('PreheatPower')
            .word16lu('Power')
            .word16lu('Temperature')
            .word16lu('Resistance')
            .word16lu('TCR')
            .word8('PIRegulatorIsEnabled')
            .word8('PIRegulatorRange')
            .word16lu('PIRegulatorPValue')
            .word16lu('PIRegulatorIValue')
            .buffer('buf', buf.length)
            .vars;

        data.Name = String(data.Name);
        data.Material = data.Flags & 0x0F;
        data.IsTemperatureDominant = Boolean(data.Flags & 0x10);
        data.IsCelcius = Boolean(data.Flags & 0x20);
        data.IsResistanceLocked = Boolean(data.Flags & 0x40);
        data.IsEnabled = Boolean(data.Flags & 0x80);

        buf = data.buf;
        delete data.buf;
        return {data, buf};
    }

    parseDeviceInfo(buf) {
        const data = binary.parse(buf)
            .word8u('Version')
            .buffer('ProductId', 4)
            .word32lu('HardwareVersion')
            .word16lu('MaxDevicePower')
            .word8u('NumberOfBatteries')
            .word8u('DisplaySize')
            .word32lu('FirmwareVersion')
            .word32lu('FirmwareBuild')
            .buffer('buf', buf.length)
            .vars;

        data.productId = String(data.productId);
        data.maxDevicePower /= 10;

        buf = data.buf;
        delete data.buf;
        return {data, buf};
    }

    parseGeneralConfiguration(buf) {
        const data = binary.parse(buf)
            .word8u('SelectedProfile')
            .word8u('SmartMode')
            .word8u('SmartRange')
            .buffer('buf', buf.length)
            .vars;

        buf = data.buf;
        delete data.buf;
        return {data, buf};
    }

    parseUiConiguration(buf) {
        const data = binary.parse(buf)
            .word8u('clicksVW0')
            .word8u('clicksVW1')
            .word8u('clicksVW2')

            .word8u('clicksTC0')
            .word8u('clicksTC1')
            .word8u('clicksTC2')

            .word8u('shortcutsVW0InStandby')
            .word8u('shortcutsVW0InEditMain')
            .word8u('shortcutsVW0InSelector')
            .word8u('shortcutsVW0InMenu')

            .word8u('shortcutsVW1InStandby')
            .word8u('shortcutsVW1InEditMain')
            .word8u('shortcutsVW1InSelector')
            .word8u('shortcutsVW1InMenu')

            .word8u('shortcutsVW2InStandby')
            .word8u('shortcutsVW2InEditMain')
            .word8u('shortcutsVW2InSelector')
            .word8u('shortcutsVW2InMenu')

            .word8u('shortcutsTC0InStandby')
            .word8u('shortcutsTC0InEditMain')
            .word8u('shortcutsTC0InSelector')
            .word8u('shortcutsTC0InMenu')

            .word8u('shortcutsTC1InStandby')
            .word8u('shortcutsTC1InEditMain')
            .word8u('shortcutsTC1InSelector')
            .word8u('shortcutsTC1InMenu')

            .word8u('shortcutsTC2InStandby')
            .word8u('shortcutsTC2InEditMain')
            .word8u('shortcutsTC2InSelector')
            .word8u('shortcutsTC2InMenu')

            .word8u('ClassicSkinVWLine1')
            .word8u('ClassicSkinVWLine2')
            .word8u('ClassicSkinVWLine3')
            .word8u('ClassicSkinVWLine4')

            .word8u('ClassicSkinTCLine1')
            .word8u('ClassicSkinTCLine2')
            .word8u('ClassicSkinTCLine3')
            .word8u('ClassicSkinTCLine4')

            .word8u('CircleSkinVWLine1')
            .word8u('CircleSkinVWLine2')
            .word8u('CircleSkinVWLine3')

            .word8u('CircleSkinTCLine1')
            .word8u('CircleSkinTCLine2')
            .word8u('CircleSkinTCLine3')

            .word8u('FoxySkinVWLine1')
            .word8u('FoxySkinVWLine2')
            .word8u('FoxySkinVWLine3')

            .word8u('FoxySkinTCLine1')
            .word8u('FoxySkinTCLine2')
            .word8u('FoxySkinTCLine3')

            .word8u('SmallSkinVWLine1')
            .word8u('SmallSkinVWLine2')

            .word8u('SmallSkinTCLine1')
            .word8u('SmallSkinTCLine2')

            .word8u('Brightness')
            .word8u('DimTimeout')
            .word8u('DimTimeoutLocked')
            .word8u('DimTimeoutCharging')
            .word8u('ShowLogoDelay')
            .word8u('ShowClockDelay')

            .word8u('IsFlipped')
            .word8u('IsStealthMode')
            .word8u('WakeUpByPlusMinus')
            .word8u('IsPowerStep1W')
            .word8u('IsTemperatureStep1C2F')

            .word8u('ChargeScreenType')
            .word8u('ChargeExtraType')

            .word8u('IsLogoEnabled')
            .word8u('IsClassicMenu')

            .word8u('ClockType')
            .word8u('IsClockOnMainScreen')

            .word8u('ScreensaveDuration')
            .word8u('PuffScreenDelay')
            .word8u('PuffsTimeFormat')

            .word8u('MainScreenSkin')
            .word8u('IsUpDownSwapped')
            .word8u('ShowChargingInStealth')
            .word8u('ShowScreensaverInStealth')
            .word8u('ClockOnClickInStealth')
            .word8u('FiveClicks')

            .word32lu('PuffsCount')
            .word32lu('PuffsTime')

            .word16lu('Year')
            .word8u('Month')
            .word8u('Day')
            .word8u('Hour')
            .word8u('Minute')
            .word8u('Second')

            .buffer('buf', buf.length)
            .vars;

        buf = data.buf;
        delete data.buf;
        return {data, buf};
    }

    parseCustomBattery(buf) {
        const data = binary.parse(buf)
            .buffer('Name', 4)
            .buffer('buf', buf.length)
            .vars;

        buf = data.buf;
        delete data.buf;

        data.PercentsVoltage = [];

        for (let i = 0; i < 11; i++) {
            const pvres = binary.parse(buf)
                .word16lu('Percents')
                .word16lu('Voltage')
                .buffer('buf', buf.length)
                .vars;

            pvres.Voltage /= 100;

            buf = pvres.buf;
            delete pvres.buf;
            data.PercentsVoltage.push(pvres);
        }

        const cores = binary.parse(buf)
            .word16lu('Cutoff')
            .buffer('buf', buf.length)
            .vars;

        data.Cutoff = cores.Cutoff / 100;
        buf = cores.buf;

        data.Name = String(data.Name);

        return {data, buf};
    }

    parseTFRTable(buf) {
        const data = binary.parse(buf)
            .buffer('Name', 4)
            .buffer('buf', buf.length)
            .vars;

        buf = data.buf;
        delete data.buf;

        data.Points = [];

        for (let i = 0; i < 7; i++) {
            const pres = binary.parse(buf)
                .word16lu('Temperature')
                .word16lu('Factor')
                .buffer('buf', buf.length)
                .vars;

            pres.Factor /= 10000;

            buf = pres.buf;
            delete pres.buf;
            data.Points.push(pres);
        }

        data.Name = String(data.Name);

        return {data, buf};
    }

    parsePowerCurve(buf) {
        const data = binary.parse(buf)
            .buffer('Name', 8)
            .buffer('buf', buf.length)
            .vars;

        buf = data.buf;
        delete data.buf;

        data.Points = [];

        for (let i = 0; i < 12; i++) {
            const pres = binary.parse(buf)
                .word8u('Time')
                .word8u('Percent')
                .buffer('buf', buf.length)
                .vars;

            pres.Time /= 10;

            buf = pres.buf;
            delete pres.buf;
            data.Points.push(pres);
        }

        data.Name = String(data.Name);

        return {data, buf};
    }

    parseAdvancedConfiguration(buf) {
        const data = binary.parse(buf)
            .word8u('ShuntCorrection')
            .word8u('BatteryModel')

            .buffer('buf', buf.length)
            .vars;

        buf = data.buf;
        delete data.buf;

        data.CustomBatteryProfiles = [];
        for (let i = 0; i < 3; i++) {
            const cbres = this.parseCustomBattery(buf);
            buf = cbres.buf;
            delete cbres.buf;
            data.CustomBatteryProfiles.push(cbres.data);
        }

        const data2 = binary.parse(buf)
            .word8u('RtcMode')
            .word8u('IsUsbCharge')
            .word8u('ResetCountersOnStartup')
            .buffer('buf', buf.length)
            .vars;

        buf = data2.buf;
        delete data2.buf;
        this.extend(data, data2);

        data.TFRTables = [];
        for (let i = 0; i < 8; i++) {
            const tfrres = this.parseTFRTable(buf);
            buf = tfrres.buf;
            delete tfrres.buf;
            data.TFRTables.push(tfrres.data);
        }

        const pcores = binary.parse(buf)
            .word8u('PuffCutOff')
            .buffer('buf', buf.length)
            .vars;

        data.PuffCutOff = pcores.PuffCutOff;
        buf = pcores.buf;

        data.PowerCurves = [];
        for (let i = 0; i < 8; i++) {
            const pcres = this.parsePowerCurve(buf);
            buf = pcres.buf;
            delete pcres.buf;
            data.PowerCurves.push(pcres.data);
        }

        const data3 = binary.parse(buf)
            .word8s('BatteryVoltageOffset1')
            .word8s('BatteryVoltageOffset2')
            .word8s('BatteryVoltageOffset3')
            .word8s('BatteryVoltageOffset4')
            .word8u('CheckTCR')
            .word8u('UsbNoSleep')
            .word8u('DeepSleepMode')
            .word8u('DeepSleepDelay')
            .word16lu('PowerLimit')
            .word8u('InternalResistance')
            .buffer('buf', buf.length)
            .vars;

        buf = data3.buf;
        delete data3.buf;

        data3.PowerLimit /= 10;
        data3.InternalResistance /= 1000;

        this.extend(data, data3);

        return {data, buf};
    }

    parseConfiguration(buf) {
        // See https://github.com/TBXin/NFirmwareEditor/blob/master/src/NToolbox/Models/ArcticFoxConfiguration.cs
        let res = this.parseDeviceInfo(buf);
        const data = res.data;

        data.profiles = [];
        for (let i = 0; i < 8; i++) {
            res = this.parseProfile(res.buf);
            data.profiles.push(res.data);
        }

        res = this.parseGeneralConfiguration(res.buf);
        this.extend(data, res.data);

        res = this.parseUiConiguration(res.buf);
        this.extend(data, res.data);

        res = this.parseAdvancedConfiguration(res.buf);
        this.extend(data, res.data);

        return data;
    }

    extend(obj1, obj2) {
        Object.keys(obj2).forEach(key => {
            obj1[key] = obj2[key];
        });
    }

    restart() {
        return this.hidWrite(this.createCommand(this.commands.restart, 0, 0));
    }

    makePuff(seconds) {
        return this.hidWrite(this.createCommand(this.commands.puff, seconds, 0));
    }

    screenshot(callback) {
        if (this.hidWrite(this.createCommand(this.commands.screenshot, 0, 0x400))) {
            this.expectedAnswer = 'screenshot';
            this.callback = callback;
            this.timeout = setTimeout(() => {
                this.callback = null;
                callback(new Error('timeout'));
            }, this.callbackTimeout);
        } else {
            callback(new Error());
        }
    }

    setDateTime(date) {
        if (!(date instanceof Date)) {
            return false;
        }
        const y = date.getFullYear();
        const payload = [
            y & 0xff,
            (y & 0xff00) >> 8,
            date.getMonth() + 1,
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds()
        ];

        return this.hidWrite(this.createCommand(this.commands.setDateTime, 0, 0)) && this.hidWrite(payload);
    }

    readMonitoringData(callback) {
        if (this.hidWrite(this.createCommand(this.commands.readMonitoringData, 0, this.monitoringDataLength))) {
            this.expectedAnswer = 'monitoringData';
            this.callback = callback;
            this.timeout = setTimeout(() => {
                this.callback = null;
                callback(new Error('timeout'));
            }, this.callbackTimeout);
        } else {
            callback(new Error());
        }
    }

    readConfiguration(callback) {
        if (this.hidWrite(this.createCommand(this.commands.readConfiguration, 0, this.configurationLength))) {
            this.expectedAnswer = 'configuration';
            this.callback = callback;
            this.timeout = setTimeout(() => {
                this.callback = null;
                callback(new Error('timeout'));
            }, this.callbackTimeout);
        } else {
            callback(new Error());
        }
    }

}

module.exports = new ArcticFox();
