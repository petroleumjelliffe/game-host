// Polyfill localStorage for jsdom environment
if (typeof window !== 'undefined' && !window.localStorage) {
  const storage: Record<string, string> = {};
  window.localStorage = {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { Object.keys(storage).forEach(key => delete storage[key]); },
    key: (index: number) => Object.keys(storage)[index] || null,
    length: 0,
  } as any;
  Object.defineProperty(window.localStorage, 'length', {
    get: () => Object.keys(storage).length,
  });
}
