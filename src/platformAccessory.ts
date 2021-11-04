import {CharacteristicValue, Logger, PlatformAccessory} from 'homebridge';

import {WattBoxHomebridgePlatform} from './platform';
import {WattBox, WattBoxOutlet, WattBoxOutletAction, WattBoxOutletStatus} from './wattbox';
import {HAP} from 'homebridge/lib/api';

export class WattBoxOutletPlatformAccessory {
  private readonly log: Logger = this.platform.log;
  private readonly hap: HAP = this.platform.api.hap;
  private readonly wattbox: WattBox = this.platform.wattbox;
  private readonly outlet: WattBoxOutlet = this.accessory.context.outlet;

  private status: WattBoxOutletStatus | null = null;

  constructor(
    private readonly platform: WattBoxHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.Service.Outlet)!
      .setCharacteristic(this.platform.Characteristic.Name, this.outlet.name)
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    setTimeout(() => {
      this.wattbox.getOutletStatus(this.outlet)
        .then(({status}) => this.status = status)
        .catch(error => {
          this.log.error(error);
          this.status = null;
        });
    }, 1000);
  }

  async setOn(value: CharacteristicValue) {
    this.log.debug('[%s] Set Characteristic On ->', this.outlet.name, value);
    try {
      await this.wattbox.commandOutlet(
        this.outlet,
        value as boolean ? WattBoxOutletAction.ON : WattBoxOutletAction.OFF,
      );
    } catch (e) {
      throw new this.hap.HapStatusError(this.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getOn(): Promise<CharacteristicValue> {
    if (this.status === null) {
      throw new this.hap.HapStatusError(this.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    }
    const isOn = this.status === WattBoxOutletStatus.ON;
    this.log.debug('[%s] Get Characteristic On ->', this.outlet.name, isOn);
    return isOn;
  }
}
