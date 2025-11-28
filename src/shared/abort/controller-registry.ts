export class ControllerRegistry {
  private map = new Map<string, AbortController>();

  register(key: string, controller: AbortController): void {
    this.map.set(key, controller);
  }

  get(key: string): AbortController | undefined {
    return this.map.get(key);
  }

  abort(key: string, reason?: any): boolean {
    const c = this.map.get(key);
    if (!c) return false;
    try {
      c.abort(reason);
    } finally {
      this.map.delete(key);
    }
    return true;
  }

  unregister(key: string): void {
    this.map.delete(key);
  }
}

export const controllerRegistry = new ControllerRegistry();


