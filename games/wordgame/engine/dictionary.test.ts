import { createDictionary } from './dictionaryCore';
import { loadEnableDictionary } from './dictionary';

describe('createDictionary', () => {
  it('uppercases on build and lookup', () => {
    const dict = createDictionary(['cat', 'DOG', 'Fish']);
    expect(dict.has('CAT')).toBe(true);
    expect(dict.has('cat')).toBe(true);
    expect(dict.has('dog')).toBe(true);
    expect(dict.has('FISH')).toBe(true);
    expect(dict.has('BIRD')).toBe(false);
  });

  it('reports its size, deduplicated across case', () => {
    const dict = createDictionary(['cat', 'CAT', 'dog']);
    expect(dict.size).toBe(2);
  });

  it('handles an empty word list', () => {
    const dict = createDictionary([]);
    expect(dict.size).toBe(0);
    expect(dict.has('ANYTHING')).toBe(false);
  });
});

// The one test that touches the vendored 1.7MB list — everything else uses
// small fixture dictionaries.
describe('loadEnableDictionary', () => {
  it('loads the full ENABLE list', () => {
    const dict = loadEnableDictionary();
    expect(dict.size).toBe(172823);
    expect(dict.has('ZYZZYVA')).toBe(true);
    expect(dict.has('zyzzyva')).toBe(true);
    expect(dict.has('QQQQ')).toBe(false);
  });

  it('memoizes: a second call returns the same instance', () => {
    expect(loadEnableDictionary()).toBe(loadEnableDictionary());
  });
});
