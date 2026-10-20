// XXH3-64 (seed 0, default secret) — BigInt port for small/medium inputs.
const XXH3 = (() => {
  const M = (1n << 64n) - 1n;
  const SECRET = Uint8Array.from(
    "b8fe6c3923a44bbe7c01812cf721ad1cded46de9839097db7240a4a4b7b3671fcb79e64eccc0e578825ad07dccff7221b8084674f743248ee03590e6813a264c3c2852bb91c300cb88d0658b1b532ea371644897a20df94e3819ef46a9deacd8a8fa763fe39c343ff9dcbbc7c70b4f1d8a51e04bcdb45931c89f7ec9d9787364eac5ac8334d3ebc3c581a0fffa1363eb170ddd51b7f0da49d316552629d4689e2b16be587d47a1fc8ff8b8d17ad031ce45cb3a8f95160428afd7fbcabb4b407e"
      .match(/../g).map(h => parseInt(h, 16)));
  const P32_1 = 0x9E3779B1n, P32_2 = 0x85EBCA77n, P32_3 = 0xC2B2AE3Dn;
  const P64_1 = 0x9E3779B185EBCA87n, P64_2 = 0xC2B2AE3D27D4EB4Fn, P64_3 = 0x165667B19E3779F9n,
        P64_4 = 0x85EBCA77C2B2AE63n, P64_5 = 0x27D4EB2F165667C5n;
  const MX1 = 0x165667919E3779F9n, MX2 = 0x9FB21C651E98DF25n;
  const r32 = (b, i) => BigInt((b[i] | (b[i+1] << 8) | (b[i+2] << 16) | (b[i+3] << 24)) >>> 0);
  const r64 = (b, i) => r32(b, i) | (r32(b, i + 4) << 32n);
  const rotl = (x, r) => ((x << BigInt(r)) | (x >> BigInt(64 - r))) & M;
  const swap32 = x => ((x & 0xffn) << 24n) | ((x & 0xff00n) << 8n) | ((x >> 8n) & 0xff00n) | ((x >> 24n) & 0xffn);
  const swap64 = x => (swap32(x & 0xffffffffn) << 32n) | swap32(x >> 32n);
  const fold = (a, b) => { const p = a * b; return (p & M) ^ (p >> 64n); };
  const av64 = h => { h ^= h >> 33n; h = (h * P64_2) & M; h ^= h >> 29n; h = (h * P64_3) & M; return h ^ (h >> 32n); };
  const av3 = h => { h ^= h >> 37n; h = (h * MX1) & M; return h ^ (h >> 32n); };
  const rrmxmx = (h, len) => {
    h ^= rotl(h, 49) ^ rotl(h, 24); h = (h * MX2) & M;
    h ^= (h >> 35n) + BigInt(len); h = (h * MX2) & M; return h ^ (h >> 28n);
  };
  const mix16 = (b, i, s) => fold(r64(b, i) ^ r64(SECRET, s), r64(b, i + 8) ^ r64(SECRET, s + 8));
  function hash64(b) {
    const len = b.length, S = SECRET;
    if (len === 0) return av64(r64(S, 56) ^ r64(S, 64));
    if (len <= 3) {
      const c = (b[0] << 16) | (b[len >> 1] << 24) | b[len - 1] | (len << 8);
      return av64(BigInt(c >>> 0) ^ ((r32(S, 0) ^ r32(S, 4))));
    }
    if (len <= 8) {
      const in64 = r32(b, len - 4) + (r32(b, 0) << 32n);
      return rrmxmx(in64 ^ (r64(S, 8) ^ r64(S, 16)), len);
    }
    if (len <= 16) {
      const lo = r64(b, 0) ^ (r64(S, 24) ^ r64(S, 32));
      const hi = r64(b, len - 8) ^ (r64(S, 40) ^ r64(S, 48));
      return av3((BigInt(len) + swap64(lo) + hi + fold(lo, hi)) & M);
    }
    if (len <= 128) {
      let acc = (BigInt(len) * P64_1) & M;
      if (len > 32) {
        if (len > 64) {
          if (len > 96) { acc += mix16(b, 48, 96); acc += mix16(b, len - 64, 112); }
          acc += mix16(b, 32, 64); acc += mix16(b, len - 48, 80);
        }
        acc += mix16(b, 16, 32); acc += mix16(b, len - 32, 48);
      }
      acc += mix16(b, 0, 0); acc += mix16(b, len - 16, 16);
      return av3(acc & M);
    }
    if (len <= 240) {
      let acc = (BigInt(len) * P64_1) & M;
      for (let i = 0; i < 8; i++) acc += mix16(b, 16 * i, 16 * i);
      let accEnd = mix16(b, len - 16, 136 - 17);
      acc = av3(acc & M);
      const rounds = Math.floor(len / 16);
      for (let i = 8; i < rounds; i++) accEnd += mix16(b, 16 * i, 16 * (i - 8) + 3);
      return av3((acc + accEnd) & M);
    }
    // long input
    const acc = [P32_3, P64_1, P64_2, P64_3, P64_4, P32_2, P64_5, P32_1];
    const acc512 = (i, s) => {
      for (let k = 0; k < 8; k++) {
        const dv = r64(b, i + 8 * k), dk = dv ^ r64(S, s + 8 * k);
        acc[k ^ 1] = (acc[k ^ 1] + dv) & M;
        acc[k] = (acc[k] + (dk & 0xffffffffn) * (dk >> 32n)) & M;
      }
    };
    const scramble = s => {
      for (let k = 0; k < 8; k++) {
        let a = acc[k]; a ^= a >> 47n; a ^= r64(S, s + 8 * k); acc[k] = (a * P32_1) & M;
      }
    };
    const stripesPerBlock = (192 - 64) / 8, blockLen = 64 * stripesPerBlock;
    const nbBlocks = Math.floor((len - 1) / blockLen);
    for (let n = 0; n < nbBlocks; n++) {
      for (let st = 0; st < stripesPerBlock; st++) acc512(n * blockLen + st * 64, st * 8);
      scramble(192 - 64);
    }
    const nbStripes = Math.floor(((len - 1) - blockLen * nbBlocks) / 64);
    for (let st = 0; st < nbStripes; st++) acc512(nbBlocks * blockLen + st * 64, st * 8);
    acc512(len - 64, 192 - 64 - 7);
    let res = (BigInt(len) * P64_1) & M;
    for (let k = 0; k < 4; k++) res += fold(acc[2 * k] ^ r64(S, 11 + 16 * k), acc[2 * k + 1] ^ r64(S, 11 + 16 * k + 8));
    return av3(res & M);
  }
  return { hash64, low32: b => Number(hash64(b) & 0xffffffffn) >>> 0 };
})();
if (typeof module !== 'undefined') module.exports = XXH3;
