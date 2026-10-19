// Asset loading: images and decoded audio, fetched from the repository's existing sprites / sounds / music folders.

/**
 * Load an image.
 *
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image ${url}`));
    img.src = url;
  });
}

/**
 * Load a set of images in parallel.
 *
 * @param {string} base Folder URL, with trailing slash.
 * @param {Object<string, string>} names Map of key -> file name.
 * @param {function} [onLoad] Called as each one arrives (for a progress bar).
 * @returns {Promise<Object<string, HTMLImageElement>>} Map of key -> image.
 */
export async function loadImages(base, names, onLoad = () => {}) {
  const entries = Object.entries(names);
  const images = await Promise.all(entries.map(([, file]) => loadImage(base + file).then((img) => { onLoad(); return img; })));
  const out = {};
  entries.forEach(([key], i) => { out[key] = images[i]; });
  return out;
}

/**
 * Fetch and decode an audio file. Decoding works while the AudioContext is still suspended (before the first
 * user gesture), so everything can be loaded up front.
 *
 * @param {AudioContext} ctx
 * @param {string} url
 * @returns {Promise<AudioBuffer|null>} null if the file is missing or can't be decoded (reported to the console).
 */
export async function loadAudio(ctx, url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.arrayBuffer();
    return await ctx.decodeAudioData(data);
  } catch (e) {
    console.warn(`Audio not loaded: ${url} (${e.message})`);
    return null;
  }
}

/**
 * Load a set of audio files in parallel.
 *
 * @param {AudioContext} ctx
 * @param {string} base Folder URL, with trailing slash.
 * @param {Object<string, string>} names Map of key -> file name.
 * @param {function} [onLoad] Called as each one is done with, loaded or not (for a progress bar).
 * @returns {Promise<Object<string, AudioBuffer|null>>}
 */
export async function loadAudioSet(ctx, base, names, onLoad = () => {}) {
  const entries = Object.entries(names);
  const buffers = await Promise.all(entries.map(([, file]) => loadAudio(ctx, base + file).then((buffer) => { onLoad(); return buffer; })));
  const out = {};
  entries.forEach(([key], i) => { out[key] = buffers[i]; });
  return out;
}
