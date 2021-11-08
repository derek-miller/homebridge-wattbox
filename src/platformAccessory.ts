import { CharacteristicValue, PlatformAccessory } from 'homebridge';

import { WattBoxHomebridgePlatform } from './platform';
import { WattBoxOutletAction, WattBoxOutletStatus } from './wattbox';

export interface WattBoxOutletPlatformAccessoryContext {
  outletId: string;
  outletName: string;
  model: string;
  serialNumber: string;
}

export class WattBoxOutletPlatformAccessory {
  private readonly log = this.platform.log;
  private readonly hap = this.platform.api.hap;
  private readonly wattbox = this.platform.wattbox;
  private readonly context = <WattBoxOutletPlatformAccessoryContext>this.accessory.context;
  private readonly outletId = this.context.outletId;
  private readonly outletName = this.context.outletName;
  private readonly model = this.context.model;
  private readonly serialNumber = this.context.serialNumber;
  private readonly id = `${this.serialNumber}:${this.outletId}`;

  private status = WattBoxOutletStatus.UNKNOWN;

  constructor(
    private readonly platform: WattBoxHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
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

  async setOn(value: CharacteristicValue): Promise<void> {
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

  async getOn(): Promise<CharacteristicValue> {
    if (this.status === null) {
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
