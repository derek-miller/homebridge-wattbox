# homebridge-wattbox

[![NPM Version](https://img.shields.io/npm/v/homebridge-wattbox.svg)](https://www.npmjs.com/package/homebridge-wattbox)

# WattBox Homebridge Platform Plugin

[WattBox](https://www.snapav.com/shop/en/snapav/wattbox) plugin
for [Homebridge](https://github.com/homebridge/homebridge).

## Models Supported

- WB-300
- WB-300VB
- WB-700
- WB-700CH

## Configuration

### Required Configuration

```json
{
  "platforms": [
    {
      "platform": "WattBox",
      "name": "WattBox",
      "address": "http://192.168.1.100",
      "username": "wattbox",
      "password": "wattbox"
    }
  ]
}
```

### Optional Configuration

#### Disable Control Switch

Considering how easy it is to accidentally command an outlet from HomeKit you
can optionally add a switch to disable control. When on, commands to control an
outlet will be ignored:

```
{
  "platforms": [
    {
      // ... required config, see above
      "disableSwitch": { // Defaults to null
        "name": "<name>" // Defaults to "Disable Control"
        "timeout": <number> // Defaults to 60, 0 or null to disable. After timeout, control is re-disabled.
      }
    }
  ]
}
```

#### Include/Exclude Outlets

Outlets can be included or excluded by name:

```
{
  "platforms": [
    {
      // ... required config, see above
      "includeOutlets": ["<name>"], // Defaults to null
      "excludeOutlets": ["<name>"] // Defaults to null
    }
  ]
}
```

### Advanced Configuration

These config values should not be configured under normal situations, but are
exposed nonetheless. Min, max, and default values are enforced to keep the
plugin usable.

#### Status Cache TTL

The time to live (in seconds) for a cached status to avoid excessive API calls:

```
{
  "platforms": [
    {
      // ... required config, see above
      "outletStatusCacheTtl": <seconds>>, // Defaults to 15
    }
  ]
}
```

#### Status Poll Interval

The polling interval (in milliseconds) to query the API for status changes:

```
{
  "platforms": [
    {
      // ... required config, see above
      "outletStatusPollInterval": <milliseconds>>, // Defaults to 15000
    }
  ]
}
```
