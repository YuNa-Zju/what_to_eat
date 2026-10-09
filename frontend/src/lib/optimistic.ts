/** Server snapshots stay separate from pending entity patches, so refreshes cannot erase writes. */
export class OptimisticStore<T> {
  private value: T;
  private pending = new Map<string, (value: T) => T>();
  private listeners = new Set<() => void>();
  private visible: T;
  private revision = 0;
  constructor(initial: T) {
    this.value = this.visible = initial;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.visible;
  serverSnapshot = () => this.value;
  version = () => this.revision;
  private emit() {
    this.visible = [...this.pending.values()].reduce((v, patch) => patch(v), this.value);
    this.listeners.forEach((fn) => fn());
  }
  refresh(value: T, version: number) {
    if (version === this.revision) {
      this.value = value;
      this.emit();
    }
  }
  update(patch: (value: T) => T) {
    this.revision++;
    this.value = patch(this.value);
    this.emit();
  }
  busy(key: string) {
    return this.pending.has(key);
  }
  async mutate<R>(
    key: string,
    patch: (value: T) => T,
    request: () => Promise<R>,
    commit?: (value: T, result: R) => T,
  ) {
    if (this.busy(key)) throw new Error('这项修改正在保存');
    this.revision++;
    this.pending.set(key, patch);
    this.emit();
    try {
      const result = await request();
      this.value = commit ? commit(this.value, result) : patch(this.value);
      return result;
    } finally {
      this.revision++;
      this.pending.delete(key);
      this.emit();
    }
  }
}
