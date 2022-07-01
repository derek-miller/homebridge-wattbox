import { CharacteristicValue, HAP, Logger, PlatformAccessory } from 'homebridge';

import { WattBoxHomebridgePlatform } from './platform';
import { WattBox, WattBoxOutletAction, WattBoxOutletStatus } from './wattbox';

export interface WattBoxOutletPlatformAccessoryContext {
  outletId: string;
  outletName: string;
  model: string;
  serialNumber: string;
  isDisabled: () => boolean;
}

export class WattBoxOutletPlatformAccessory {
  private readonly log: Logger;
  private readonly hap: HAP;
  private readonly wattbox: WattBox;
  private readonly context: WattBoxOutletPlatformAccessoryContext;
  private readonly outletId: string;
  private readonly outletName: string;
  private readonly model: string;
  private readonly serialNumber: string;
  private readonly isDisabled: () => boolean;
  private readonly id: string;

  private status = WattBoxOutletStatus.UNKNOWN;

  constructor(
    private readonly platform: WattBoxHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.log = this.platform.log;
    this.hap = this.platform.api.hap;
    this.wattbox = this.platform.wattbox;
    this.context = <WattBoxOutletPlatformAccessoryContext>this.accessory.context;
    this.outletId = this.context.outletId;
    this.outletName = this.context.outletName;
    this.model = this.context.model;
    this.serialNumber = this.context.serialNumber;
    this.isDisabled = this.context.isDisabled;
    this.id = `${this.serialNumber}:${this.outletId}`;
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'WattBox')
      .setCharacteristic(this.platform.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.serialNumber);

    const statusCharacteristic = (this.accessory.getService(this.platform.Service.Outlet) ||
      this.accessory.addService(this.platform.Service.Outlet, this.outletName, this.id))!
      .setCharacteristic(this.platform.Characteristic.Name, this.outletName)
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    this.wattbox.subscribe(this.outletId, ({ status }) => {
      if (this.status !== status) {
        this.log.debug(
          '[%s] Received outlet subscription status update: %s -> %s',
          this.outletName,
          WattBoxOutletStatus[this.status],
          WattBoxOutletStatus[status],
        );
        this.status = status;
        statusCharacteristic.updateValue(!!status);
      }
    });
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    if (this.isDisabled()) {
      this.log.info('[%s] Cannot set Characteristic On when disabled', this.outletName);
      throw new this.hap.HapStatusError(this.hap.HAPStatus.READ_ONLY_CHARACTERISTIC);
    }
    this.log.debug('[%s] Set Characteristic On ->', this.outletName, value);
    try {
      await this.wattbox.commandOutlet(
        this.outletId,
        value ? WattBoxOutletAction.ON : WattBoxOutletAction.OFF,
      );
    } catch (error: unknown) {
      this.log.error(
        '[%s] An error occurred setting Characteristic On; %s',
        this.outletName,
        (<Error>error).message,
      );
      throw new this.hap.HapStatusError(this.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private getOn(): CharacteristicValue {
    if (this.status === WattBoxOutletStatus.UNKNOWN) {
      throw new this.hap.HapStatusError(this.hap.HAPStatus.NOT_ALLOWED_IN_CURRENT_STATE);
    }
    this.log.debug(
      '[%s] Get Characteristic On ->',
      this.outletName,
      WattBoxOutletStatus[this.status],
    );
    return !!this.status;
  }
}
