import { Characteristic, CharacteristicValue, PlatformAccessory } from 'homebridge';

import { WattBoxHomebridgePlatform } from './platform';

export interface WattBoxDisableOutletsPlatformAccessoryContext {
  switchName: string;
  model: string;
  serialNumber: string;
  timeout: number;
}

export class WattBoxDisableOutletsPlatformAccessory {
  private readonly log = this.platform.log;
  private readonly context = <WattBoxDisableOutletsPlatformAccessoryContext>this.accessory.context;
  private readonly switchName = this.context.switchName;
  private readonly model = this.context.model;
  private readonly serialNumber = this.context.serialNumber;
  private readonly timeout = this.context.timeout;
  private readonly id = this.serialNumber;

  private disabled = true;
  private onCharacteristic: Characteristic;

  constructor(
    private readonly platform: WattBoxHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WattBox')
      .setCharacteristic(this.platform.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.serialNumber);

    this.onCharacteristic = (this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch, this.switchName, this.id))!
      .setCharacteristic(this.platform.Characteristic.Name, this.switchName)
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
  }

  private setOn(value: CharacteristicValue): void {
    this.log.debug('[%s] Set Characteristic On ->', this.switchName, value);
    this.disabled = !!value;
    if (!this.disabled && this.timeout > 0) {
      setTimeout(() => {
        // Ignore if it has already been re-disabled.
        if (this.disabled) {
          return;
        }
        this.disabled = true;
        this.log.debug(
          '[%s] Update Characteristic On due to enabled timeout ->',
          this.switchName,
          this.disabled,
        );
        this.onCharacteristic.updateValue(this.disabled);
      }, this.timeout * 1000);
    }
  }

  private getOn(): CharacteristicValue {
    this.log.debug('[%s] Get Characteristic On ->', this.switchName, this.disabled);
    return this.isDisabled();
  }

  public isDisabled() {
    return this.disabled;
  }
}
