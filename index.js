const events = require('events');
const binary = require('binary');
const HID = require('node-hid');

const products = {
    E052: 'Joyetech eVic VTC Mini',
    E043: 'Joyetech eVic VTwo',
    E115: 'Joyetech eVic VTwo Mini',
    E079: 'Joyetech eVic VTC Dual',
    E150: 'Joyetech eVic Basic',
    E092: 'Joyetech eVic AIO',
    E182: 'Joyetech eVic Primo',
    E203: 'Joyetech eVic Primo 2.0',
    E196: 'Joyetech eVic Primo Mini',

    E060: 'Joyetech Cuboid',
    E056: 'Joyetech Cuboid Mini',
    E166: 'Joyetech Cuboid 200',

    E083: 'Joyetech eGrip II',

    M973: 'Eleaf iStick QC 200W',
    M972: 'Eleaf iStick TC200W',
    M011: 'Eleaf iStick TC100W',
    M041: 'Eleaf iStick Pico',
    M038: 'Eleaf iStick Pico RDTA',
    M045: 'Eleaf iStick Pico Mega',
    M065: 'Eleaf iStick Pico Dual',
    M046: 'Eleaf iStick Power',
    M037: 'Eleaf ASTER',

    W007: 'Wismec Presa TC75W',
    W017: 'Wismec Presa TC100W',

    W018: 'Wismec Reuleaux RX2/3',
    W014: 'Wismec Reuleaux RX200',
    W033: 'Wismec Reuleaux RX200S',
    W026: 'Wismec Reuleaux RX75',
    W069: 'Wismec Reuleaux RX300',
    W073: 'Wismec Reuleaux RXmini',
    W078: 'Wismec Predator',

    W010: 'Vaporflask Classic',
    W011: 'Vaporflask Lite',
    W013: 'Vaporflask Stout',

    W016: 'Beyondvape Centurion',
    W043: 'Vaponaute La Petit Box',

    W057: 'Vapor Shark SwitchBox RX'
};

class ArcticFox extends events.EventEmitter {
    constructor() {
        super();

        this.hid = null;
        this.connected = false;
        this.reconnectTimeout = 1000;
        this.callbackTimeout = 1000;

        this.minimumSupportedBuildNumber = 170603;
        this.supportedSettingsVersion = 9;

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
                                this.parseConfiguration(message, (err, config) => {
                                    this.callback(err, config);
                                    this.callback = null;
                                });
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
                        break;
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
        const arr = [
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
        data.Power /= 10;
        data.Resistance /= 1000;
        data.PreheatTime /= 100;
        data.PreheatDelay /= 10;
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
            .word8u('SettingsVersion')
            .buffer('ProductId', 4)
            .word32lu('HardwareVersion')
            .word16lu('MaxDevicePower')
            .word8u('NumberOfBatteries')
            .word8u('DisplaySize')
            .word32lu('FirmwareVersion')
            .word32lu('FirmwareBuild')
            .buffer('buf', buf.length)
            .vars;

        data.ProductId = String(data.ProductId);
        data.ProductName = products[data.ProductId];
        data.HardwareVersion = String(data.HardwareVersion / 100);
        data.MaxDevicePower /= 10;

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
            .word8u('ClicksVW0')
            .word8u('ClicksVW1')
            .word8u('ClicksVW2')

            .word8u('ClicksTC0')
            .word8u('ClicksTC1')
            .word8u('ClicksTC2')

            .word8u('ShortcutsVW0InStandby')
            .word8u('ShortcutsVW0InEditMain')
            .word8u('ShortcutsVW0InSelector')
            .word8u('ShortcutsVW0InMenu')

            .word8u('ShortcutsVW1InStandby')
            .word8u('ShortcutsVW1InEditMain')
            .word8u('ShortcutsVW1InSelector')
            .word8u('ShortcutsVW1InMenu')

            .word8u('ShortcutsVW2InStandby')
            .word8u('ShortcutsVW2InEditMain')
            .word8u('ShortcutsVW2InSelector')
            .word8u('ShortcutsVW2InMenu')

            .word8u('ShortcutsTC0InStandby')
            .word8u('ShortcutsTC0InEditMain')
            .word8u('ShortcutsTC0InSelector')
            .word8u('ShortcutsTC0InMenu')

            .word8u('ShortcutsTC1InStandby')
            .word8u('ShortcutsTC1InEditMain')
            .word8u('ShortcutsTC1InSelector')
            .word8u('ShortcutsTC1InMenu')

            .word8u('ShortcutsTC2InStandby')
            .word8u('ShortcutsTC2InEditMain')
            .word8u('ShortcutsTC2InSelector')
            .word8u('ShortcutsTC2InMenu')

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

        data.IsFlipped = Boolean(data.IsFlipped);
        data.IsStealthMode = Boolean(data.IsStealthMode);
        data.WakeUpByPlusMinus = Boolean(data.WakeUpByPlusMinus);
        data.IsPowerStep1W = Boolean(data.IsPowerStep1W);
        data.IsTemperatureStep1C2F = Boolean(data.IsTemperatureStep1C2F);
        data.IsLogoEnabled = Boolean(data.IsLogoEnabled);
        data.IsClassicMenu = Boolean(data.IsClassicMenu);
        data.IsClockOnMainScreen = Boolean(data.IsClockOnMainScreen);
        data.IsUpDownSwapped = Boolean(data.IsUpDownSwapped);
        data.ShowChargingInStealth = Boolean(data.ShowChargingInStealth);
        data.ShowScreensaverInStealth = Boolean(data.ShowScreensaverInStealth);
        data.ClockOnClickInStealth = Boolean(data.ClockOnClickInStealth);

        data.ClassicSkinVWLine1Puff = Boolean(data.ClassicSkinVWLine1 & 0x80);
        data.ClassicSkinVWLine1 = data.ClassicSkinVWLine1 & 0x7f;
        data.ClassicSkinVWLine2Puff = Boolean(data.ClassicSkinVWLine2 & 0x80);
        data.ClassicSkinVWLine2 = data.ClassicSkinVWLine2 & 0x7f;
        data.ClassicSkinVWLine3Puff = Boolean(data.ClassicSkinVWLine3 & 0x80);
        data.ClassicSkinVWLine3 = data.ClassicSkinVWLine3 & 0x7f;
        data.ClassicSkinVWLine4Puff = Boolean(data.ClassicSkinVWLine4 & 0x80);
        data.ClassicSkinVWLine4 = data.ClassicSkinVWLine4 & 0x7f;

        data.ClassicSkinTCLine1Puff = Boolean(data.ClassicSkinTCLine1 & 0x80);
        data.ClassicSkinTCLine1 = data.ClassicSkinTCLine1 & 0x7f;
        data.ClassicSkinTCLine2Puff = Boolean(data.ClassicSkinTCLine2 & 0x80);
        data.ClassicSkinTCLine2 = data.ClassicSkinTCLine2 & 0x7f;
        data.ClassicSkinTCLine3Puff = Boolean(data.ClassicSkinTCLine3 & 0x80);
        data.ClassicSkinTCLine3 = data.ClassicSkinTCLine3 & 0x7f;
        data.ClassicSkinTCLine4Puff = Boolean(data.ClassicSkinTCLine4 & 0x80);
        data.ClassicSkinTCLine4 = data.ClassicSkinTCLine4 & 0x7f;

        data.CircleSkinVWLine1 = data.CircleSkinVWLine1 & 0x7f;
        data.CircleSkinVWLine2 = data.CircleSkinVWLine2 & 0x7f;
        data.CircleSkinVWLine3Puff = Boolean(data.CircleSkinVWLine3 & 0x80);
        data.CircleSkinVWLine3 = data.CircleSkinVWLine3 & 0x7f;

        data.CircleSkinTCLine1 = data.CircleSkinTCLine1 & 0x7f;
        data.CircleSkinTCLine2 = data.CircleSkinTCLine2 & 0x7f;
        data.CircleSkinTCLine3Puff = Boolean(data.CircleSkinTCLine3 & 0x80);
        data.CircleSkinTCLine3 = data.CircleSkinTCLine3 & 0x7f;

        data.FoxySkinVWLine1Puff = Boolean(data.FoxySkinVWLine1 & 0x80);
        data.FoxySkinVWLine1 = data.FoxySkinVWLine1 & 0x7f;
        data.FoxySkinVWLine2Puff = Boolean(data.FoxySkinVWLine2 & 0x80);
        data.FoxySkinVWLine2 = data.FoxySkinVWLine2 & 0x7f;
        data.FoxySkinVWLine3Puff = Boolean(data.FoxySkinVWLine3 & 0x80);
        data.FoxySkinVWLine3 = data.FoxySkinVWLine3 & 0x7f;

        data.FoxySkinTCLine1Puff = Boolean(data.FoxySkinTCLine1 & 0x80);
        data.FoxySkinTCLine1 = data.FoxySkinTCLine1 & 0x7f;
        data.FoxySkinTCLine2Puff = Boolean(data.FoxySkinTCLine2 & 0x80);
        data.FoxySkinTCLine2 = data.FoxySkinTCLine2 & 0x7f;
        data.FoxySkinTCLine3Puff = Boolean(data.FoxySkinTCLine3 & 0x80);
        data.FoxySkinTCLine3 = data.FoxySkinTCLine3 & 0x7f;

        data.SmallSkinVWLine1Puff = Boolean(data.SmallSkinVWLine1 & 0x80);
        data.SmallSkinVWLine1 = data.SmallSkinVWLine1 & 0x7f;
        data.SmallSkinVWLine2Puff = Boolean(data.SmallSkinVWLine2 & 0x80);
        data.SmallSkinVWLine2 = data.SmallSkinVWLine2 & 0x7f;

        data.SmallSkinTCLine1Puff = Boolean(data.SmallSkinTCLine1 & 0x80);
        data.SmallSkinTCLine1 = data.SmallSkinTCLine1 & 0x7f;
        data.SmallSkinTCLine2Puff = Boolean(data.SmallSkinTCLine2 & 0x80);
        data.SmallSkinTCLine2 = data.SmallSkinTCLine2 & 0x7f;

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

        data2.IsUsbCharge = Boolean(data2.IsUsbCharge);
        data2.ResetCountersOnStartup = Boolean(data2.ResetCountersOnStartup);

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

        data.PuffCutOff = pcores.PuffCutOff / 10;
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

        data3.CheckTCR = Boolean(data3.CheckTCR);
        data3.UsbNoSleep = Boolean(data3.UsbNoSleep);
        data3.PowerLimit /= 10;
        data3.InternalResistance /= 1000;

        this.extend(data, data3);

        return {data, buf};
    }

    parseConfiguration(buf, callback) {
        // See https://github.com/TBXin/NFirmwareEditor/blob/master/src/NToolbox/Models/ArcticFoxConfiguration.cs
        let res = this.parseDeviceInfo(buf);
        const data = res.data;

        if (data.SettingsVersion > this.supportedSettingsVersion) {
            callback(new Error('Outdated Toolbox'));
            return;
        } else if ((data.FirmwareBuild < this.minimumSupportedBuildNumber) || (data.SettingsVersion < this.supportedSettingsVersion)) {
            callback(new Error('Outdated Firmware'));
            return;
        }

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

        callback(null, data);
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
            y & 0xFF,
            (y & 0xFF00) >> 8,
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
