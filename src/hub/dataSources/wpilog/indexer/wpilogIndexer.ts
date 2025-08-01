// Copyright (c) 2021-2025 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

export async function run(
  data: Uint8Array,
  timestampRangeCallback: (min: number, max: number) => void,
  recordCallback: (entry: number, position: number) => void
) {
  self.importScripts("./hub$wpilogIndexer.js");
  await new Promise<void>((resolve) => {
    Module.onRuntimeInitialized = resolve;
  });

  const bufferIn = Module._malloc(data.length);
  console.log(Module);
  console.log(Module.HEAPU8);
  Module.HEAPU8.set(data, bufferIn);
  const bufferOut = Module._run(bufferIn, data.length);

  const minTimestamp = Module.HEAPF64[bufferOut / 8];
  const maxTimestamp = Module.HEAPF64[bufferOut / 8 + 1];
  timestampRangeCallback(minTimestamp, maxTimestamp);

  const recordCount = Module.HEAPU32[bufferOut / 4 + 4];
  for (let i = 0; i < recordCount; i++) {
    let entry = Module.HEAPU32[bufferOut / 4 + 5 + i * 2];
    let position = Module.HEAPU32[bufferOut / 4 + 5 + i * 2 + 1];
    recordCallback(entry, position);
  }
}

var Module: {
  onRuntimeInitialized(): void;
  _malloc(size: number): number;
  _run(buffer: number, bufferSize: number): number;
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
};
