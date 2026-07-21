// Shrink Meshy GLBs: keep only baseColor texture (resized jpeg), drop normal/PBR maps.
import fs from 'fs';
import sharp from 'sharp';

const align4 = n => (n + 3) & ~3;
async function shrink(path, out, maxTex) {
  const b = fs.readFileSync(path);
  const jlen = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jlen).toString());
  const binStart = 20 + jlen + 8;
  const bin = b.slice(binStart, binStart + b.readUInt32LE(20 + jlen));

  // which images are baseColor?
  const keepImg = new Set();
  for (const m of json.materials || []) {
    const bc = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
    if (bc != null) keepImg.add(json.textures[bc.index].source);
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.metallicRoughnessTexture;
  }
  // resize kept images
  const newImages = [];
  const imgData = [];
  for (const idx of keepImg) {
    const img = json.images[idx];
    const bv = json.bufferViews[img.bufferView];
    const bytes = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const outBytes = await sharp(bytes).resize(maxTex, maxTex, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer();
    imgData.push({ oldIdx: idx, bytes: outBytes });
  }
  // rebuild bufferViews: non-image views first
  const imageBvSet = new Set((json.images || []).map(i => i.bufferView));
  const bvMap = new Map();
  const newBVs = [];
  const chunks = [];
  let off = 0;
  json.bufferViews.forEach((bv, i) => {
    if (imageBvSet.has(i)) return;
    const bytes = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const nbv = Object.assign({}, bv, { byteOffset: off });
    bvMap.set(i, newBVs.length);
    newBVs.push(nbv); chunks.push(bytes);
    off = align4(off + bytes.length);
    const pad = off - ((nbv.byteOffset) + bytes.length);
    if (pad) chunks.push(Buffer.alloc(pad));
  });
  const imgMap = new Map();
  imgData.forEach((d, k) => {
    newBVs.push({ buffer: 0, byteOffset: off, byteLength: d.bytes.length });
    chunks.push(d.bytes);
    off = align4(off + d.bytes.length);
    const pad = off - (newBVs[newBVs.length - 1].byteOffset + d.bytes.length);
    if (pad) chunks.push(Buffer.alloc(pad));
    imgMap.set(d.oldIdx, k);
    newImages.push({ mimeType: 'image/jpeg', bufferView: newBVs.length - 1 });
  });
  // remap accessor -> bufferView
  for (const a of json.accessors || []) if (a.bufferView != null) a.bufferView = bvMap.get(a.bufferView);
  // rebuild textures + material refs
  const newTextures = [];
  const texMap = new Map();
  (json.textures || []).forEach((t, i) => {
    if (imgMap.has(t.source)) { texMap.set(i, newTextures.length); newTextures.push({ source: imgMap.get(t.source), sampler: t.sampler }); }
  });
  for (const m of json.materials || []) {
    const bc = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
    if (bc != null) bc.index = texMap.get(bc.index);
  }
  json.images = newImages;
  json.textures = newTextures;
  json.bufferViews = newBVs;
  json.buffers = [{ byteLength: off }];
  // serialize
  let jstr = Buffer.from(JSON.stringify(json));
  const jpad = align4(jstr.length) - jstr.length;
  if (jpad) jstr = Buffer.concat([jstr, Buffer.from(' '.repeat(jpad))]);
  const binBuf = Buffer.concat(chunks);
  const total = 12 + 8 + jstr.length + 8 + binBuf.length;
  const outB = Buffer.alloc(12 + 8);
  outB.writeUInt32LE(0x46546C67, 0); outB.writeUInt32LE(2, 4); outB.writeUInt32LE(total, 8);
  outB.writeUInt32LE(jstr.length, 12); outB.writeUInt32LE(0x4E4F534A, 16);
  const binHdr = Buffer.alloc(8);
  binHdr.writeUInt32LE(binBuf.length, 0); binHdr.writeUInt32LE(0x004E4942, 4);
  fs.writeFileSync(out, Buffer.concat([outB, jstr, binHdr, binBuf]));
  console.log(path, (b.length / 1e6).toFixed(1) + 'MB ->', (fs.statSync(out).size / 1e6).toFixed(2) + 'MB');
}
for (const k of (process.argv.length > 2 ? process.argv.slice(2) : ['sports', 'sedan', 'heli', 'tank', 'man']))
  await shrink('assets/' + k + '.glb', 'assets/' + k + '.glb', 768);
