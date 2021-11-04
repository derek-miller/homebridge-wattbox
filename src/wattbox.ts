import xml2js from 'xml2js';
import {Logger} from 'homebridge';

import axios, {AxiosInstance, AxiosRequestConfig, AxiosResponse} from 'axios';
import * as http from 'http';
import AsyncLock from 'async-lock';

export interface WattBoxStatus {
  hostname: string;
  model: string;
  serialNumber: string;
  connectionStatuses: WattBoxConnectionStatus[];
  autoRebootEnabled: boolean;
  outletInfos: WattBoxOutletInfo[];
  // TODO: led
  safeVoltageStatus: WattBoxSafeVoltageStatus;
  voltage: number;
  current: number;
  power: number;
  cloudOnline: boolean;
  ups: WattBoxUpsStatus | null;
}

export interface WattBoxConnectionStatus {
  targetIp: string;
  responseTimeMs: number;
  timeoutPercent: number;
}

export interface WattBoxOutlet {
  id: string;
  name: string;
}

export interface WattBoxOutletInfo {
  outlet: WattBoxOutlet;
  status: WattBoxOutletStatus;
  mode: WattBoxOutletMode;
}

export enum WattBoxOutletStatus {
  OFF = 0,
  ON = 1
}

export enum WattBoxOutletMode {
  DISABLED = 0,
  NORMAL = 1,
  RESET_ONLY = 2
}

// TODO
// enum WattBoxLedStatus {
//   OFF = 0,
//   GREEN_ON = 1,
//   RED_ON = 2,
//   GREEN_BLINKING = 3,
//   RED_BLINKING = 4,
// }

enum WattBoxSafeVoltageStatus {
  OFF = 0,
  SAFE = 1,
  UNSAFE = 2,
}

export enum WattBoxOutletAction {
  OFF = 0,
  ON = 1,
  POWER_RESET = 3, // Outlet must be on.
  AUTO_REBOOT_ON = 4,
  AUTO_REBOOT_OFF = 5,
}

export interface WattBoxUpsStatus {
  audibleAlarmEnabled: boolean;
  estRunTimeMinutes: number;
  batteryTestEnabled: boolean;
  batteryHealthy: boolean;
  batteryChargePercent: number;
  batteryLoadPercent: number;
  onBattery: boolean;
  isMuted: boolean;
}

export class WattBox {
  private static STATUS_TTL_MS = 5000;

  private session: AxiosInstance;
  private lock: AsyncLock = new AsyncLock();
  private lastStatus: WattBoxStatus | null = null;
  private lastStatusTime: Date = new Date();

  constructor(
    public readonly log: Logger,
    private readonly address: string,
    private readonly username: string,
    private readonly password: string,
  ) {
    this.session = axios.create({
      httpAgent: new http.Agent({keepAlive: true}),
      baseURL: this.address,
      responseType: 'document',
      timeout: 5000,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`,
      },
    });
  }

  async getStatus(): Promise<WattBoxStatus> {
    return this.lock.acquire('getStatus', async () => {
      if (!this.lastStatus || (new Date().getTime() - this.lastStatusTime.getTime()) > WattBox.STATUS_TTL_MS) {
        const {request} = await this.xmlRequest<WattBoxInfoResponse>({method: 'get', url: '/wattbox_info.xml'});
        this.lastStatusTime = new Date();
        this.lastStatus = {
          hostname: request.host_name,
          model: request.hardware_version,
          serialNumber: request.serial_number,
          connectionStatuses: request.site_ip.map((ip, i) => ({
            targetIp: ip,
            responseTimeMs: parseInt(request.connect_status[i]),
            timeoutPercent: parseInt(request.site_lost[i]),
          })).filter(({targetIp}) => targetIp !== '0'),
          autoRebootEnabled: request.auto_reboot === '1',
          outletInfos: request.outlet_name.map((name, i) => ({
            outlet: {
              id: `${i + 1}`,
              name,
            },
            status: parseInt(request.outlet_status[i]),
            mode: parseInt(request.outlet_method[i]),
          })),
          safeVoltageStatus: parseInt(request.safe_voltage_status),
          voltage: parseInt(request.voltage_value) / 10.0,
          current: parseInt(request.current_value) / 10.0,
          power: parseInt(request.power_value) / 10.0,
          cloudOnline: request.cloud_status === '1',
          ups: request.hasUPS === '0' ? null : {
            audibleAlarmEnabled: request.audible_alarm === '1',
            estRunTimeMinutes: parseInt(request.est_run_time),
            batteryTestEnabled: request.battery_test === '1',
            batteryHealthy: request.battery_health === '1',
            batteryChargePercent: parseInt(request.battery_charge),
            batteryLoadPercent: parseInt(request.battery_load),
            onBattery: request.power_lost === '1',
            isMuted: request.mute === '1',
          },
        };
      }
      return this.lastStatus;
    });
  }

  async getOutletStatus(outlet: WattBoxOutlet): Promise<WattBoxOutletInfo> {
    const {outletInfos} = await this.getStatus();
    const outletInfo = outletInfos.find(({outlet: {id}}) => id === outlet.id) ?? null;
    if (outletInfo === null) {
      throw new Error(`unknown outlet [name: "${outlet.name ?? ''}", id: ${outlet.id}]`);
    }
    return outletInfo;
  }

  async commandOutlet(outlet: WattBoxOutlet, command: WattBoxOutletAction): Promise<void> {
    return this.lock.acquire('getStatus', async () => {
      await this.xmlRequest({
        method: 'get',
        url: '/control.cgi',
        params: {
          outlet: outlet.id,
          command,
        },
      });
      this.lastStatus = null;
    });
  }

  private async xmlRequest<T = never, D = never>(config: AxiosRequestConfig<D>): Promise<T> {
    const {data} = <AxiosResponse<T>>await this.session.request(config);
    return parser.parseStringPromise(data);
  }
}

const parser = new xml2js.Parser({
  explicitArray: false,
  valueProcessors: [
    (value) => {
      return value.includes(',') ? value.split(',').map(v => v.trim()) : value;
    },
  ],
});

interface WattBoxInfoResponse {
  request: WattBoxInfo;
}

interface WattBoxInfo {
  host_name: string;
  hardware_version: string;
  serial_number: string;
  site_ip: string[];
  connect_status: string[];
  site_lost: string[];
  auto_reboot: string;
  outlet_name: string[];
  outlet_status: string[];
  outlet_method: string[];
  led_status: string[];
  safe_voltage_status: string;
  voltage_value: string;
  current_value: string;
  power_value: string;
  cloud_status: string;
  hasUPS: string;
  audible_alarm: string;
  est_run_time: string;
  battery_test: string;
  battery_health: string;
  battery_charge: string;
  battery_load: string;
  power_lost: string;
  mute: string;
}
