import type { GameEvent, EventName } from "../../shared-types/src/index";
export class EventBus {
  private listeners = new Map<EventName, Set<(event: GameEvent) => void>>();
  subscribe(type: EventName, handler: (event: GameEvent) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }
  dispatch(event: GameEvent) {
    for (const handler of this.listeners.get(event.type) ?? []) handler(event);
  }
  dispose() {
    this.listeners.clear();
  }
}
