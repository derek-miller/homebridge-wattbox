import {
  API,
  APIEvent,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import {
  WattBoxOutletPlatformAccessory,
  WattBoxOutletPlatformAccessoryContext,
} from './platformAccessory';
import { WattBox, WattBoxConfig } from './wattbox';
import {
  WattBoxDisableOutletsPlatformAccessory,
  WattBoxDisableOutletsPlatformAccessoryContext,
} from './platformAccessoryDisable';

type WattBoxHomebridgePlatformConfig = PlatformConfig &
  WattBoxConfig & {
    disableSwitch?: WattBoxDisableOutletsConfigDisableSwitch;
    includeOutlets?: string[];
    excludeOutlets?: string[];
  };

export interface WattBoxDisableOutletsConfigDisableSwitch {
  name?: string;
  timeout?: number;
}

export class WattBoxHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  public readonly config: WattBoxHomebridgePlatformConfig;
  public readonly wattbox: WattBox;

  constructor(
    public readonly log: Logger,
    public readonly platformConfig: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.config = <WattBoxHomebridgePlatformConfig>this.platformConfig;
    this.wattbox = new WattBox(log, this.config);
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, async () => this.discoverDevices());
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverDevices() {
    const wattBoxStatus = await this.wattbox.getStatus();
    const discoveredUUIDs: Set<string> = new Set();

    let isDisabled = () => false;
    if (this.config.disableSwitch) {
      const { name: switchName = 'Disable Control', timeout = 0 } = this.config.disableSwitch;
      const uuid = this.api.hap.uuid.generate(wattBoxStatus.information.serialNumber);
      discoveredUUIDs.add(uuid);
      let accessory = this.accessories.find((accessory) => accessory.UUID === uuid);
      const existingAccessory = !!accessory;
      accessory = accessory ?? new this.api.platformAccessory(switchName, uuid);

      // Update the accessory context with the outlet.
      accessory.context = <WattBoxDisableOutletsPlatformAccessoryContext>{
        switchName,
        model: wattBoxStatus.information.model,
        serialNumber: wattBoxStatus.information.serialNumber,
        defaultDisabled: true,
        timeout,
      };

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', accessory.displayName);
        this.api.updatePlatformAccessories([accessory]);
      } else {
        this.log.info('Adding new accessory:', switchName);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      const disable = new WattBoxDisableOutletsPlatformAccessory(this, accessory);
      isDisabled = () => disable.isDisabled();
    }
    for (const { id, name } of wattBoxStatus.outlets) {
      if (Array.isArray(this.config.excludeOutlets) && this.config.excludeOutlets.includes(name)) {
        continue;
      }
      if (Array.isArray(this.config.includeOutlets) && !this.config.includeOutlets.includes(name)) {
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${wattBoxStatus.information.serialNumber}:${id}`);
      discoveredUUIDs.add(uuid);

      let accessory = this.accessories.find((accessory) => accessory.UUID === uuid);
      const existingAccessory = !!accessory;
      accessory = accessory ?? new this.api.platformAccessory(name, uuid);

      // Update the accessory context with the outlet.
      accessory.context = <WattBoxOutletPlatformAccessoryContext>{
        outletId: id,
        outletName: name,
        model: wattBoxStatus.information.model,
        serialNumber: wattBoxStatus.information.serialNumber,
        isDisabled,
      };

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', accessory.displayName);
        this.api.updatePlatformAccessories([accessory]);
      } else {
        this.log.info('Adding new accessory:', name);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      new WattBoxOutletPlatformAccessory(this, accessory);
    }
    const orphanedAccessories = this.accessories.filter(
      (accessory) => !discoveredUUIDs.has(accessory.UUID),
    );
    if (orphanedAccessories.length > 0) {
      this.log.info(
        'Removing orphaned accessories from cache: ',
        orphanedAccessories.map(({ displayName }) => displayName).join(', '),
      );
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, orphanedAccessories);
    }
  }
}
