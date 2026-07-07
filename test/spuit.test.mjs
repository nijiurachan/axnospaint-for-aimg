import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  getSpuitPreviewImageData,
  getSpuitSampleImageData,
} from '../src/js/pendefine/spuit.js';

const OriginalImageData = globalThis.ImageData;

class TestImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

globalThis.ImageData = TestImageData;

test.after(() => {
  globalThis.ImageData = OriginalImageData;
});

test('spuit samples the composited canvas by default', () => {
  const composited = { data: new Uint8ClampedArray([10, 20, 30, 255]) };
  const currentLayer = { data: new Uint8ClampedArray([200, 210, 220, 128]) };
  const calls = [];
  const axpObj = {
    CANVAS: {
      main_ctx: {
        getImageData: (...args) => {
          calls.push(['main', ...args]);
          return composited;
        },
      },
    },
    layerSystem: {
      getImage: () => {
        calls.push(['layer']);
        return currentLayer;
      },
    },
  };

  assert.equal(getSpuitSampleImageData(axpObj, 3, 4), composited);
  assert.deepEqual(calls, [['main', 3, 4, 1, 1]]);
});

test('spuit samples the current layer when layer mode is selected', () => {
  const composited = { data: new Uint8ClampedArray([10, 20, 30, 255]) };
  const currentLayer = {
    width: 3,
    height: 3,
    data: new Uint8ClampedArray([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      50, 60, 70, 80,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]),
  };
  const calls = [];
  const axpObj = {
    CANVAS: {
      main_ctx: {
        getImageData: (...args) => {
          calls.push(['main', ...args]);
          return composited;
        },
      },
    },
    layerSystem: {
      getImage: () => {
        calls.push(['layer']);
        return currentLayer;
      },
    },
  };

  const sample = getSpuitSampleImageData(axpObj, 1, 1, 'option_layer');

  assert.deepEqual([...sample.data], [50, 60, 70, 80]);
  assert.deepEqual(calls, [['layer']]);
});

test('spuit layer sampling returns transparent pixels outside the current layer bounds', () => {
  const currentLayer = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
    ]),
  };
  const axpObj = {
    CANVAS: {
      main_ctx: {
        getImageData: () => {
          throw new Error('composited sampling should not be used in layer mode');
        },
      },
    },
    layerSystem: {
      getImage: () => currentLayer,
    },
  };

  assert.deepEqual([...getSpuitSampleImageData(axpObj, -1, 0, 'option_layer').data], [0, 0, 0, 0]);
  assert.deepEqual([...getSpuitSampleImageData(axpObj, -0.001, 0, 'option_layer').data], [0, 0, 0, 0]);
  assert.deepEqual([...getSpuitSampleImageData(axpObj, 2, 0, 'option_layer').data], [0, 0, 0, 0]);
  assert.deepEqual([...getSpuitSampleImageData(axpObj, 0, 2, 'option_layer').data], [0, 0, 0, 0]);
});

test('spuit layer preview crops the current layer before drawing at preview coordinates', () => {
  const currentLayer = {
    width: 4,
    height: 3,
    data: new Uint8ClampedArray([
      1, 2, 3, 255,
      4, 5, 6, 255,
      7, 8, 9, 255,
      10, 11, 12, 255,
      13, 14, 15, 255,
      16, 17, 18, 255,
      19, 20, 21, 255,
      22, 23, 24, 255,
      25, 26, 27, 255,
      28, 29, 30, 255,
      31, 32, 33, 255,
      34, 35, 36, 255,
    ]),
  };
  const axpObj = {
    layerSystem: {
      getImage: () => currentLayer,
    },
  };

  const preview = getSpuitPreviewImageData(axpObj, 1, 1, 2, 2);

  assert.equal(preview.width, 2);
  assert.equal(preview.height, 2);
  assert.deepEqual([...preview.data], [
    16, 17, 18, 255,
    19, 20, 21, 255,
    28, 29, 30, 255,
    31, 32, 33, 255,
  ]);

  const source = readFileSync(new URL('../src/js/pendefine/spuit.js', import.meta.url), 'utf8');
  assert.match(source, /ctx\.putImageData\(previewImageData,\s*dx,\s*dy\);/);
});

test('pen window exposes a dedicated spuit sample mode selector', () => {
  const html = readFileSync(new URL('../src/html/window_pen.txt', import.meta.url), 'utf8');
  const dictionary = JSON.parse(readFileSync(new URL('../src/text/ja.json', import.meta.url), 'utf8'));

  assert.match(html, /id="axp_pen_select_spuitSampleMode"/);
  assert.match(html, /data-msg="@PEN0025"/);
  assert.ok(html.includes('aria-label="${_("@PEN.SPUIT_SAMPLE_MODE")}"'));
  assert.ok(html.includes('<option value="option_all" selected>${_("@PEN.OPTION_SPUIT_SAMPLE_ALL")}</option>'));
  assert.ok(html.includes('<option value="option_layer">${_("@PEN.OPTION_SPUIT_SAMPLE_CURRENT")}</option>'));
  assert.equal(dictionary['@PEN.OPTION_SPUIT_SAMPLE_ALL'], '表示色から取得');
  assert.equal(dictionary['@PEN.OPTION_SPUIT_SAMPLE_CURRENT'], '現レイヤーから取得');
});

test('PenSystem spuit uses the selected spuit sample mode helper', () => {
  const source = readFileSync(new URL('../src/js/window_pen.js', import.meta.url), 'utf8');

  assert.match(source, /getSpuitSampleMode\(\) \{/);
  assert.match(
    source,
    /var imagedata = getSpuitSampleImageData\(this\.axpObj, x, y, this\.getSpuitSampleMode\(\)\);/
  );
});

test('PenSystem spuit ignores fully transparent samples instead of selecting black', () => {
  const source = readFileSync(new URL('../src/js/window_pen.js', import.meta.url), 'utf8');

  assert.match(source, /if \(imagedata\.data\[3\] === 0\) \{[\s\S]*?return;[\s\S]*?\}/);
});
