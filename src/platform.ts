import {
  API,
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
import { WattBox } from './wattbox';
import { APIEvent } from 'homebridge/lib/api';

export class WattBoxHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly wattbox: WattBox;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.wattbox = new WattBox(log, config.address, config.username, config.password);
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, async () => this.discoverDevices());
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverDevices() {
    const wattBoxStatus = await this.wattbox.getStatus();
    const discoveredUUIDs: Set<string> = new Set();

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
