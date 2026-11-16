// Run once on the selected exposure. Landmarks, pixels and the mask all use
// the same orientation, including mirrored camera frames.
import {note} from './report.js';
import {fetchBytes} from './loading.js';
const assets = new URL('./vendor/mediapipe/', import.meta.url);
// Phone: fetch the 9.5 MB engine here so the page can say how far it is, then hand
// the bytes over. If that fails the library fetches the file itself, as before.
async function streamedEngine(files) {
  try {
    note('engine found' + (/nosimd/.test(files.wasmBinaryPath) ? ' (plain build: no SIMD here)' : ''));
    const bytes = await fetchBytes(files.wasmBinaryPath, 'cut-out engine');
    return {...files, wasmBinaryPath: URL.createObjectURL(new Blob([bytes], {type: 'application/wasm'}))};
  } catch (error) { note('engine left to the library (' + error.message + ')'); return files; }
}
const tasks = new Map();
let runtime;

async function loadTask(multipleSitters) {
  if (!runtime) {
    runtime = import('./vendor/mediapipe/vision_bundle.mjs').then(async vision => ({
      vision,
      files: await streamedEngine(await vision.FilesetResolver.forVisionTasks(new URL('wasm', assets).href))
    })).catch(error => { runtime = null; throw error; });
  }
  const {vision, files} = await runtime;
  const type = multipleSitters ? vision.InteractiveSegmenter : vision.ImageSegmenter;
  const model = multipleSitters ? 'magic_touch.tflite' : 'selfie_segmenter.tflite';
  return type.createFromOptions(files, {
    baseOptions: {modelAssetPath: new URL(model, assets).href, delegate: 'CPU'},
    outputConfidenceMasks: true,
    outputCategoryMask: false
  });
}

export function prepareMatte(multipleSitters) {
  if (!tasks.has(multipleSitters)) {
    const pending = loadTask(multipleSitters).catch(error => {
      tasks.delete(multipleSitters);
      throw error;
    });
    tasks.set(multipleSitters, pending);
  }
  return tasks.get(multipleSitters);
}

function maskForFace(mask, face, others) {
  const {width, height} = mask;
  const values = mask.getAsFloat32Array();
  const index = (x, y) => Math.min(height - 1, Math.max(0, Math.floor(y * height))) * width
    + Math.min(width - 1, Math.max(0, Math.floor(x * width)));
  const centreOf = ([x,y,w,h]) => index(x + w * .5, y + h * .50);
  const seed = centreOf(face.box);
  if (!(values[seed] >= .5)) return null;

  // Keep only the foreground connected to the chosen sitter. Wall pixels and
  // disconnected people must also be transparent inside the head/shoulder box.
  const selected = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let read = 0, count = 0;
  function visit(i) {
    if (!selected[i] && values[i] > .28) {
      selected[i] = 1;
      queue[count++] = i;
    }
  }
  visit(seed);
  while (read < count) {
    const i = queue[read++], x = i % width;
    if (x > 0) visit(i - 1);
    if (x + 1 < width) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i + width < values.length) visit(i + width);
  }
  if (others.some(other => selected[centreOf(other.box)])) return null;

  const [x, y, w, h] = face.box;
  // Reject a tiny feature or a mask that covers essentially the whole room.
  if (count < w * h * width * height * .65 || (count > .985 * values.length && w * h < .35)) return null;
  for (const u of [.3, .7]) if (!selected[index(x + u * w, y + .5 * h)]) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let k = 0; k < count; k++) {
    const i = queue[k];
    const t = Math.max(0, Math.min(1, (values[i] - .28) / .50));
    image.data[4 * i + 3] = 255 * t * t * (3 - 2 * t);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// Trial (masks): hair, face skin, body skin, clothes, accessories. One more small
// model in the runtime that is already loaded for the cut-out.
let classTask;
export const classMap = {phase: 'idle', fraction: 0, since: 0};
export function prepareClasses() {
  classTask ??= (async () => {
    await prepareMatte(false);
    const {vision, files} = await runtime;
    classMap.phase = 'downloading'; classMap.since = performance.now();
    const model = await fetchBytes(new URL('./models/mediapipe/selfie_multiclass_256x256.tflite', import.meta.url).href, 'hair/skin model', fraction => { classMap.fraction = fraction; });
    classMap.phase = 'creating';
    const began = performance.now();
    const task = await vision.ImageSegmenter.createFromOptions(files, {
      baseOptions: {modelAssetBuffer: model, delegate: 'CPU'},
      outputCategoryMask: true,
      outputConfidenceMasks: false
    });
    classMap.phase = 'ready';
    note('hair/skin model ready (set up in ' + ((performance.now() - began) / 1000).toFixed(1) + ' s)');
    return task;
  })().catch(error => { classTask = null; classMap.phase = 'failed'; note('ERROR hair/skin model: ' + error.message); throw error; });
  return classTask;
}
async function sitterClasses(input) {
  const task = await prepareClasses();
  let found = null;
  task.segment(input, result => {
    const map = result.categoryMask;
    found = {width: map.width, height: map.height, data: map.getAsUint8Array().slice()};
  });
  return found;
}

export async function sitterMatte(frame, face, others) {
  const scale = Math.min(1, 768 / Math.max(frame.width, frame.height));
  const input = document.createElement('canvas');
  input.width = Math.max(1, Math.round(frame.width * scale));
  input.height = Math.max(1, Math.round(frame.height * scale));
  input.getContext('2d').drawImage(frame, 0, 0, input.width, input.height);
  const multiple = others.length > 0;
  const task = await prepareMatte(multiple);
  let matte;
  function read(result) {
    const masks = result.confidenceMasks;
    if (masks?.length) matte = maskForFace(masks[masks.length - 1], face, others);
  }
  if (multiple) {
    const [x,y,w,h] = face.box;
    task.segment(input, {keypoint: {x: x + w * .5, y: y + h * .5}}, read);
  } else {
    task.segment(input, read);
  }
  note('cut-out ' + (matte ? 'found' : 'NOT found') + ' on a ' + input.width + 'x' + input.height + ' copy');
  if (!matte) throw Error('The portrait could not separate you from the room. Try another exposure with your face and shoulders visible.');
  const began = performance.now();
  try {
    if (classMap.phase === 'failed') throw new Error('the model did not load');
    prepareClasses().catch(() => {});
    for (;;) {
      const waited = performance.now() - began;
      if (classMap.phase === 'ready') break;
      if (classMap.phase === 'failed') throw new Error('the model did not load');
      if (waited > 20000) throw new Error('not ready after 20 s');
      if (classMap.phase === 'downloading' && waited > 2500) {
        const spent = performance.now() - classMap.since;
        const left = classMap.fraction > 0 ? spent * (1 - classMap.fraction) / classMap.fraction : Infinity;
        if (left > 12000) throw new Error('still downloading, ' + Math.round(100 * classMap.fraction) + ' % here');
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    matte.classes = await sitterClasses(input);
    note('hair/skin map in ' + ((performance.now() - began) / 1000).toFixed(1) + ' s');
  } catch (error) {
    note('hair/skin map unavailable (' + error.message + '): painting without it');
    console.warn('Hair and skin map unavailable for this sitting.', error.message);
  }
  return matte;
}
