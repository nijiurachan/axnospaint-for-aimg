import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/js/saveload.js', import.meta.url), 'utf8');

test('manual save slots are expanded to twenty', () => {
  assert.match(source, /const MANUALSAVE_MAX = 20;/);
  assert.match(source, /const DB_VERSION = 4;/);
});

test('manual save slot setup is generated for body and thumbnail stores', () => {
  assert.match(source, /const STORE_NAME_SAVE_MANUAL_THUMBNAIL = 'save_manual_thumbnail';/);
  assert.match(source, /function createManualSaveSlotId\(index\)/);
  assert.match(source, /String\(index\)\.padStart\(2, '0'\)/);
  assert.match(source, /for \(let index = startIndex; index <= MANUALSAVE_MAX; index\+\+\)/);
  assert.match(source, /putEmptyManualSaveSlots\(storeManual\);/);
  assert.match(source, /putEmptyManualSaveSlots\(storeManualThumbnail\);/);
});

test('manual save thumbnails are stored separately from save bodies', () => {
  assert.match(source, /function createManualSaveThumbnail\(data\)/);
  assert.match(source, /const thumbnail = createManualSaveThumbnail\(\{[\s\S]*?src: this\.axpObj\.assistToolSystem\.CANVAS\.thumbnail\.toDataURL\(\)/);
  assert.match(source, /await this\.dbSystem\.saveManualToDB\(data, thumbnail\);/);
  assert.doesNotMatch(source, /const data = \{[\s\S]*?src: this\.axpObj\.assistToolSystem\.CANVAS\.thumbnail\.toDataURL\(\)[\s\S]*?\};\s*\n\s*const thumbnail =/);
});

test('manual save lists read thumbnails instead of full save bodies', () => {
  assert.match(source, /const listStoreName = storeName === STORE_NAME_SAVE_MANUAL\s*\?\s*STORE_NAME_SAVE_MANUAL_THUMBNAIL\s*:\s*storeName;/);
  assert.match(source, /const transaction = db\.transaction\(listStoreName\);/);
});

test('existing manual save databases migrate thumbnails and add only missing slots', () => {
  assert.match(source, /migrateManualSaveThumbnails\(storeManual, storeManualThumbnail\);/);
  assert.match(source, /const startIndex = event\.oldVersion <= 2 \? 6 : 11;/);
  assert.match(source, /putEmptyManualSaveSlots\(storeManual, startIndex\);/);
  assert.match(source, /putEmptyManualSaveSlots\(storeManualThumbnail, startIndex\);/);
  assert.match(source, /delete saveData\.src;/);
});
