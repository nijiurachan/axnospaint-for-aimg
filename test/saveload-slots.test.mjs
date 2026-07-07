import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DB_VERSION,
  MANUALSAVE_MAX,
  createManualSaveSlotId,
  getManualSaveSlotMigrationStartIndex,
  putEmptyManualSaveSlots,
  splitManualSaveData,
} from '../src/js/saveload.js';

function createRecordingStore(initialRecords = []) {
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]));
  return {
    putCalls: [],
    records,
    put(record) {
      const nextRecord = { ...record };
      this.putCalls.push(nextRecord);
      records.set(nextRecord.id, nextRecord);
    },
  };
}

function createSlotIds(startIndex, endIndex) {
  const ids = [];
  for (let index = startIndex; index <= endIndex; index++) {
    ids.push(createManualSaveSlotId(index));
  }
  return ids;
}

test('manual save slots are expanded to twenty with a new database version', () => {
  assert.equal(MANUALSAVE_MAX, 20);
  assert.equal(DB_VERSION, 4);
  assert.equal(createManualSaveSlotId(1), 'save_01');
  assert.equal(createManualSaveSlotId(20), 'save_20');
});

test('manual save slot migration preserves existing ten-slot records', () => {
  const existingSlot = {
    id: 'save_06',
    created: new Date('2026-07-07T00:00:00Z'),
    marker: 'keep',
  };
  const store = createRecordingStore([existingSlot]);
  const startIndex = getManualSaveSlotMigrationStartIndex(3);

  putEmptyManualSaveSlots(store, startIndex);

  assert.deepEqual(store.putCalls.map((record) => record.id), createSlotIds(11, 20));
  assert.deepEqual(store.records.get('save_06'), existingSlot);
});

test('manual save slot migration adds the expanded range for five-slot databases', () => {
  const store = createRecordingStore([{ id: 'save_05', marker: 'keep' }]);
  const startIndex = getManualSaveSlotMigrationStartIndex(2);

  putEmptyManualSaveSlots(store, startIndex);

  assert.deepEqual(store.putCalls.map((record) => record.id), createSlotIds(6, 20));
  assert.deepEqual(store.records.get('save_05'), { id: 'save_05', marker: 'keep' });
});

test('manual save body and thumbnail split keeps matching IDs without storing thumbnail src in the body', () => {
  const fullSaveData = {
    id: 'save_06',
    version: 3,
    created: new Date('2026-07-07T01:23:45Z'),
    src: 'data:image/png;base64,thumbnail',
    x_max: 320,
    y_max: 240,
    counter: 2,
    layer: [{ index: 0 }],
    oekaki_id: 'oekaki-123',
    draftImageFile: 'https://example.test/draft.png',
    transparent: false,
  };

  const { body, thumbnail } = splitManualSaveData(fullSaveData);

  assert.equal(body.id, thumbnail.id);
  assert.equal(thumbnail.id, fullSaveData.id);
  assert.equal(thumbnail.src, fullSaveData.src);
  assert.equal(thumbnail.oekaki_id, fullSaveData.oekaki_id);
  assert.equal(thumbnail.draftImageFile, fullSaveData.draftImageFile);
  assert.equal(Object.hasOwn(body, 'src'), false);
  assert.equal(fullSaveData.src, 'data:image/png;base64,thumbnail');
});
