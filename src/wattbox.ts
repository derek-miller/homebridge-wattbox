import xml2js from 'xml2js';
import PubSub from 'pubsub-js';
import { Logger } from 'homebridge';

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import * as http from 'http';
import AsyncLock from 'async-lock';
import EventEmitter from 'events';
import Token = PubSubJS.Token;

export interface WattBoxStatus {
  information: WattBoxInformation;
  autoReboot: WattBoxAutoReboot;
  outlets: WattBoxOutlet[];
  leds: WattBoxLEDs;
  safeVoltageStatus: WattBoxSafeVoltageStatus;
  voltage: number;
  current: number;
  power: number;
  cloudOnline: boolean;
  ups: WattBoxUPS | null;
}

export interface WattBoxInformation {
  hostname: string;
  model: string;
  serialNumber: string;
}

export interface WattBoxAutoReboot {
  enabled: boolean;
  connections: WattBoxConnectionStatus[];
}

export interface WattBoxConnectionStatus {
  targetIp: string;
  responseTimeMs: number;
  timeoutPercent: number;
}

export interface WattBoxOutlet {
  id: string;
  name: string;
  status: WattBoxOutletStatus;
  mode: WattBoxOutletMode;
}

export enum WattBoxOutletStatus {
  UNKNOWN = -1,
  OFF = 0,
  ON = 1,
}

export enum WattBoxOutletMode {
  DISABLED = 0,
  NORMAL = 1,
  RESET_ONLY = 2,
}

export interface WattBoxLEDs {
  internet: WattBoxLedStatus;
  system: WattBoxLedStatus;
  autoReboot: WattBoxLedStatus;
}

export enum WattBoxLedStatus {
  OFF = 0,
  GREEN_ON = 1,
  RED_ON = 2,
  GREEN_BLINKING = 3,
  RED_BLINKING = 4,
}

export enum WattBoxSafeVoltageStatus {
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

export interface WattBoxUPS {
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
  private static readonly PUB_SUB_OUTLET_TOPIC = 'outlet';
  private static readonly STATUS_CACHE_TTL_MS = 5000;

  // Events
  private static readonly POLL: string = 'POLL';
  private static readonly STATUS_LOCK_NAME = 'STATUS';
  private static readonly STATUS_UPDATE = 'STATUS_UPDATE';
  private static readonly TRIGGER_STATUS_UPDATE = 'TRIGGER_STATUS_UPDATE';

  private lock: AsyncLock = new AsyncLock();
  private session: AxiosInstance;
  private emitter: EventEmitter = new EventEmitter();
  private cachedStatus: WattBoxStatus | null = null;
  private cachedStatusError: Error | null = null;
  private outletIdSubscriptions: Record<Token, string> = {};

  constructor(
    public readonly log: Logger,
    private readonly address: string,
    private readonly username: string,
    private readonly password: string,
  ) {
    this.session = axios.create({
      httpAgent: new http.Agent({ keepAlive: true }),
      baseURL: this.address,
      responseType: 'document',
      timeout: 5000,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString(
          'base64',
        )}`,
      },
    });
    this.emitter.on(WattBox.POLL, async () => {
      if (PubSub.countSubscriptions(WattBox.PUB_SUB_OUTLET_TOPIC) === 0) {
        this.log.debug('[API] There are no outlet status subscriptions; skipping poll');
        return;
      }
      try {
        await this.getStatus();
      } catch (error: unknown) {
        if (error instanceof Error) {
          this.log.error('[API] An error occurred polling for a status update; %s', error.message);
        }
      }
    });
    this.emitter.on(WattBox.TRIGGER_STATUS_UPDATE, () => {
      this.cachedStatusError = null;
      this.cachedStatus = null;
      this.emitter.emit(WattBox.POLL);
    });
    this.emitter.on(WattBox.STATUS_UPDATE, (error, status) => {
      // Trigger a status update after the ttl expires.
      setTimeout(
        () => this.emitter.emit(WattBox.TRIGGER_STATUS_UPDATE),
        WattBox.STATUS_CACHE_TTL_MS,
      );

      if (status) {
        // Publish status updates to each of the outlet subscriptions.
        for (const outlet of status.outlets) {
          PubSub.publish(`${WattBox.PUB_SUB_OUTLET_TOPIC}.${outlet.id}`, outlet);
        }
      }
    });
  }

  subscribe(outletId: string, func: (outlet: WattBoxOutlet) => void): Token {
    this.log.debug('[API] Status subscription added for outlet %s', outletId);
    const token = PubSub.subscribe(
      `${WattBox.PUB_SUB_OUTLET_TOPIC}.${outletId}`,
      async (_, data) => {
        if (!data) {
          return;
        }
        return func(data);
      },
    );
    this.outletIdSubscriptions[token] = outletId;

    // Trigger a poll to get updated status for the new subscription.
    this.emitter.emit(WattBox.POLL);

    return token;
  }

  unsubscribe(token: Token): void {
    if (token in this.outletIdSubscriptions) {
      this.log.debug('[API] Status subscription removed for outlet %s', token);
    }
    PubSub.unsubscribe(token);
  }

  async getStatus(): Promise<WattBoxStatus> {
    return this.lock.acquire(WattBox.STATUS_LOCK_NAME, async (): Promise<WattBoxStatus> => {
      // Return/Throw cached status
      if (this.cachedStatusError) {
        throw this.cachedStatusError;
      } else if (this.cachedStatus) {
        return this.cachedStatus;
      }

      this.log.debug('[API] Fetching status from WattBox API');
      let request: WattBoxInfoResponseBody;
      try {
        ({ request } = await this.xmlRequest<WattBoxInfoResponse>({
          method: 'get',
          url: '/wattbox_info.xml',
        }));
        this.cachedStatusError = null;
        this.cachedStatus = {
          information: {
            hostname: request.host_name,
            model: request.hardware_version,
            serialNumber: request.serial_number,
          },
          autoReboot: {
            enabled: request.auto_reboot === '1',
            connections: request.site_ip
              .map((ip, i) => ({
                targetIp: ip,
                responseTimeMs: parseInt(request.connect_status[i]),
                timeoutPercent: parseInt(request.site_lost[i]),
              }))
              .filter(({ targetIp }) => targetIp !== '0'),
          },
          outlets: request.outlet_name.map((name, i) => ({
            id: `${i + 1}`,
            name,
            status: parseInt(request.outlet_status[i]),
            mode: parseInt(request.outlet_method[i]),
          })),
          leds: {
            internet: parseInt(request.led_status[0]),
            system: parseInt(request.led_status[1]),
            autoReboot: parseInt(request.led_status[2]),
          },
          safeVoltageStatus: parseInt(request.safe_voltage_status),
          voltage: parseInt(request.voltage_value) / 10.0,
          current: parseInt(request.current_value) / 10.0,
          power: parseInt(request.power_value) / 10.0,
          cloudOnline: request.cloud_status === '1',
          ups:
            request.hasUPS === '0'
              ? null
              : {
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
        return this.cachedStatus;
      } catch (error: unknown) {
        this.cachedStatusError = <Error>error;
        this.cachedStatus = null;
        throw error;
      } finally {
        this.emitter.emit(WattBox.STATUS_UPDATE, this.cachedStatusError, this.cachedStatus);
      }
    });
  }

  async getOutletStatus(outletId: string): Promise<WattBoxOutlet> {
    const { outlets } = await this.getStatus();
    const outletInfo = outlets.find(({ id }) => id === outletId) ?? null;
    if (outletInfo === null) {
      throw new Error(`unknown outlet with id=${outletId}`);
    }
    return outletInfo;
  }

  async commandOutlet(outletId: string, command: WattBoxOutletAction): Promise<void> {
    return this.lock.acquire(WattBox.STATUS_LOCK_NAME, async () => {
      await this.xmlRequest({
        method: 'get',
        url: '/control.cgi',
        params: {
          outlet: outletId,
          command,
        },
      });
      // Trigger an update to pick up any changes.
      this.emitter.emit(WattBox.TRIGGER_STATUS_UPDATE);
    });
  }

  private async xmlRequest<T = never, D = never>(config: AxiosRequestConfig<D>): Promise<T> {
    const { data } = <AxiosResponse<T>>await this.session.request(config);
    return parser.parseStringPromise(data);
  }
}

const parser = new xml2js.Parser({
  explicitArray: false,
  valueProcessors: [
    // Split comma delimited strings
    (value) => {
      return value.includes(',') ? value.split(',').map((v) => v.trim()) : value;
    },
  ],
});

interface WattBoxInfoResponse {
  request: WattBoxInfoResponseBody;
}

interface WattBoxInfoResponseBody {
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
