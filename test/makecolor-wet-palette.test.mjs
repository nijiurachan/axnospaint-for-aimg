import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/js/window_makecolor.js', import.meta.url), 'utf8');

function loadWetPaletteHelpers() {
  const start = source.indexOf('export function isValidWetPaletteDataUrl');
  const end = source.indexOf('// カラー作成制御オブジェクト');
  assert.notEqual(start, -1, 'wet palette storage helpers must be exported before ColorMakerSystem');
  assert.ok(end > start, 'wet palette storage helpers must stay before ColorMakerSystem');

  const helperSource = source.slice(start, end).replaceAll('export ', '');
  const context = { helpers: null };
  vm.runInNewContext(`${helperSource}
helpers = {
  isValidWetPaletteDataUrl,
  serializeWetPaletteCanvas,
  saveWetPaletteSnapshot,
  loadWetPaletteSnapshot,
  clearWetPaletteSnapshot,
};`, context);
  return context.helpers;
}

function loadWetPaletteMethodInstance() {
  const helperStart = source.indexOf('export function isValidWetPaletteDataUrl');
  const helperEnd = source.indexOf('// カラー作成制御オブジェクト');
  const methodStart = source.indexOf('    _saveWetPaletteSnapshot() {');
  const methodEnd = source.indexOf('    // 他システムが参照する色', methodStart);
  assert.notEqual(helperStart, -1);
  assert.ok(helperEnd > helperStart);
  assert.notEqual(methodStart, -1);
  assert.ok(methodEnd > methodStart);

  const helperSource = source.slice(helperStart, helperEnd).replaceAll('export ', '');
  const methodSource = source
    .slice(methodStart, methodEnd)
    .replace(/^ {4}/gm, '')
    .replace(/\n(?=(?:async )?(?:_[A-Za-z][A-Za-z0-9_]*|restoreWetPaletteSnapshot)\(\) \{)/g, ',\n');
  const context = {
    calls: [],
    images: [],
    instance: null,
    saveCalls: [],
    saveSystem: {
      async load_wetPalette() {
        return 'data:image/png;base64,old';
      },
      save_wetPalette(dataUrl) {
        context.saveCalls.push(['save', dataUrl]);
      },
      delete_wetPalette() {
        context.saveCalls.push(['delete']);
      },
    },
  };
  context.Image = class FakeImage {
    constructor() {
      context.images.push(this);
    }
    set src(value) {
      this.value = value;
    }
  };
  vm.runInNewContext(`${helperSource}
const wetPaletteMethods = {
${methodSource}
};
instance = {
  ...wetPaletteMethods,
  axpObj: {
    saveSystem,
  },
  wetPaletteCanvas: {
    width: 2,
    height: 2,
    toDataURL() {
      return 'data:image/png;base64,new';
    },
  },
  wetPaletteCtx: {
    clearRect() {
      calls.push('clear');
    },
    drawImage() {
      calls.push('draw');
    },
  },
};`, context);
  return context;
}

test('wet palette storage helpers serialize only valid canvas snapshots', () => {
  const { isValidWetPaletteDataUrl, serializeWetPaletteCanvas } = loadWetPaletteHelpers();

  assert.equal(isValidWetPaletteDataUrl('data:image/png;base64,abc123'), true);
  assert.equal(isValidWetPaletteDataUrl('data:text/plain;base64,abc123'), false);
  assert.equal(isValidWetPaletteDataUrl(''), false);
  assert.equal(isValidWetPaletteDataUrl(null), false);
  assert.equal(
    serializeWetPaletteCanvas({ toDataURL: () => 'data:image/png;base64,abc123' }),
    'data:image/png;base64,abc123',
  );
  assert.equal(serializeWetPaletteCanvas({ toDataURL: () => { throw new Error('blocked'); } }), null);
});

test('wet palette storage helpers never throw when persistence is unavailable', async () => {
  const {
    saveWetPaletteSnapshot,
    loadWetPaletteSnapshot,
    clearWetPaletteSnapshot,
  } = loadWetPaletteHelpers();
  const writes = [];
  const saveSystem = {
    save_wetPalette(dataUrl) {
      writes.push(['save', dataUrl]);
    },
    async load_wetPalette() {
      return 'data:image/png;base64,abc123';
    },
    delete_wetPalette() {
      writes.push(['delete']);
    },
  };

  assert.equal(
    saveWetPaletteSnapshot(saveSystem, { toDataURL: () => 'data:image/png;base64,abc123' }),
    true,
  );
  assert.deepEqual(writes.at(-1), ['save', 'data:image/png;base64,abc123']);
  assert.equal(await loadWetPaletteSnapshot(saveSystem), 'data:image/png;base64,abc123');
  assert.equal(clearWetPaletteSnapshot(saveSystem), true);
  assert.deepEqual(writes.at(-1), ['delete']);

  assert.doesNotThrow(() => saveWetPaletteSnapshot({
    save_wetPalette() {
      throw new Error('quota');
    },
  }, { toDataURL: () => 'data:image/png;base64,abc123' }));
  assert.equal(await loadWetPaletteSnapshot({
    async load_wetPalette() {
      throw new Error('blocked');
    },
  }), null);
  assert.doesNotThrow(() => clearWetPaletteSnapshot({
    delete_wetPalette() {
      throw new Error('blocked');
    },
  }));
});

test('wet palette persistence uses the indexedDB save system instead of localStorage', () => {
  const saveLoadSource = readFileSync(new URL('../src/js/saveload.js', import.meta.url), 'utf8');
  const axpSource = readFileSync(new URL('../src/js/axpobj.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /localStorage/);
  assert.match(source, /saveWetPaletteSnapshot\(this\.axpObj\.saveSystem, this\.wetPaletteCanvas\)/);
  assert.match(source, /loadWetPaletteSnapshot\(this\.axpObj\.saveSystem\)/);
  assert.match(saveLoadSource, /save_wetPalette\(dataUrl\)/);
  assert.match(saveLoadSource, /load_wetPalette\(\)/);
  assert.match(saveLoadSource, /delete_wetPalette\(\)/);
  assert.match(axpSource, /await this\.colorMakerSystem\.restoreWetPaletteSnapshot\(\);/);
});

test('wet palette drag start invalidates pending snapshot restore', () => {
  const wetPaletteStart = source.indexOf('const canvas = this.wetPaletteCanvas;');
  assert.notEqual(wetPaletteStart, -1);
  const pointerDownMatch = source
    .slice(wetPaletteStart)
    .match(/canvas\.addEventListener\('pointerdown', \(e\) => \{(?<body>[\s\S]*?)\n\s+\}\);/);

  assert.ok(pointerDownMatch);
  assert.match(pointerDownMatch.groups.body, /this\._wetPaletteRestoreToken = \(this\._wetPaletteRestoreToken \|\| 0\) \+ 1;/);
});

test('wet palette restore ignores stale image loads after the palette is cleared', async () => {
  const context = loadWetPaletteMethodInstance();

  await context.instance._restoreWetPaletteSnapshot();
  assert.equal(context.images.length, 1);
  context.instance._clearWetPaletteSnapshot();
  context.images[0].onload();

  assert.deepEqual(context.calls, []);
});
