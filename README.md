# homebridge-wattbox

[![NPM Version](https://img.shields.io/npm/v/homebridge-wattbox.svg)](https://www.npmjs.com/package/homebridge-wattbox)

# WattBox Homebridge Platform Plugin

[WattBox](https://www.snapav.com/shop/en/snapav/wattbox) plugin for [Homebridge](https://github.com/homebridge/homebridge).

## Models Supported

* WB-300
* WB-300VB
* WB-700
* WB-700CH

## Configuration

```json
"platforms": [{
  "platform": "WattBox",
  "name": "WattBox",
  "address": "http://192.168.1.100",
  "username": "wattbox",
  "password": "wattbox"
}]
```
