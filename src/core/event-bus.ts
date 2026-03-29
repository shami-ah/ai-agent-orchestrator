// ============================================================
// EventBus — Typed event emitter for OrchestraEvent
// Decouples components via publish/subscribe pattern.
// ============================================================

import { EventEmitter } from "node:events";
import type { OrchestraEvent } from "../types/index.js";

type EventType = OrchestraEvent["type"];

type EventPayload<T extends EventType> = Extract<OrchestraEvent, { type: T }>;

type EventHandler<T extends EventType> = (event: EventPayload<T>) => void;

export class EventBus {
  private readonly emitter = new EventEmitter();

  on<T extends EventType>(type: T, handler: EventHandler<T>): void {
    this.emitter.on(type, handler as (...args: unknown[]) => void);
  }

  off<T extends EventType>(type: T, handler: EventHandler<T>): void {
    this.emitter.off(type, handler as (...args: unknown[]) => void);
  }

  emit<T extends EventType>(event: EventPayload<T>): void {
    this.emitter.emit(event.type, event);
  }
}
