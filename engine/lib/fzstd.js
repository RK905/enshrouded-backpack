// fzstd 0.1.1 (c) 2020 Arjun Barrett, MIT License - https://github.com/101arrowz/fzstd
const FZSTD = (() => {
const ab = ArrayBuffer, u8 = Uint8Array, u16 = Uint16Array, i16 = Int16Array, u32 = Uint32Array, i32 = Int32Array;
const slc = (v, s, e)=>{
    if (u8.prototype.slice) return u8.prototype.slice.call(v, s, e);
    if (s == null || s < 0) s = 0;
    if (e == null || e > v.length) e = v.length;
    const n = new u8(e - s);
    n.set(v.subarray(s, e));
    return n;
};
const fill = (v, n, s, e)=>{
    if (u8.prototype.fill) return u8.prototype.fill.call(v, n, s, e);
    if (s == null || s < 0) s = 0;
    if (e == null || e > v.length) e = v.length;
    for(; s < e; ++s)v[s] = n;
    return v;
};
const cpw = (v, t, s, e)=>{
    if (u8.prototype.copyWithin) return u8.prototype.copyWithin.call(v, t, s, e);
    if (s == null || s < 0) s = 0;
    if (e == null || e > v.length) e = v.length;
    while(s < e){
        v[t++] = v[s++];
    }
};
const ZstdErrorCode = {
    InvalidData: 0,
    WindowSizeTooLarge: 1,
    InvalidBlockType: 2,
    FSEAccuracyTooHigh: 3,
    DistanceTooFarBack: 4,
    UnexpectedEOF: 5
};
const ec = [
    'invalid zstd data',
    'window size too large (>2046MB)',
    'invalid block type',
    'FSE accuracy too high',
    'match distance too far back',
    'unexpected EOF'
];
const err = (ind, msg, nt)=>{
    const e = new Error(msg || ec[ind]);
    e.code = ind;
    if (Error.captureStackTrace) Error.captureStackTrace(e, err);
    if (!nt) throw e;
    return e;
};
const rb = (d, b, n)=>{
    let i = 0, o = 0;
    for(; i < n; ++i)o |= d[b++] << (i << 3);
    return o;
};
const b4 = (d, b)=>(d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
const rzfh = (dat, w)=>{
    const n3 = dat[0] | dat[1] << 8 | dat[2] << 16;
    if (n3 == 0x2FB528 && dat[3] == 253) {
        const flg = dat[4];
        const ss = flg >> 5 & 1, cc = flg >> 2 & 1, df = flg & 3, fcf = flg >> 6;
        if (flg & 8) err(0);
        let bt = 6 - ss;
        const db = df == 3 ? 4 : df;
        const di = rb(dat, bt, db);
        bt += db;
        const fsb = fcf ? 1 << fcf : ss;
        const fss = rb(dat, bt, fsb) + (fcf == 1 && 256);
        let ws = fss;
        if (!ss) {
            const wb = 1 << 10 + (dat[5] >> 3);
            ws = wb + (wb >> 3) * (dat[5] & 7);
        }
        if (ws > 2145386496) err(1);
        const buf = new u8((w == 1 ? fss || ws : w ? 0 : ws) + 12);
        buf[0] = 1, buf[4] = 4, buf[8] = 8;
        return {
            b: bt + fsb,
            y: 0,
            l: 0,
            d: di,
            w: w && w != 1 ? w : buf.subarray(12),
            e: ws,
            o: new i32(buf.buffer, 0, 3),
            u: fss,
            c: cc,
            m: Math.min(131072, ws)
        };
    } else if ((n3 >> 4 | dat[3] << 20) == 0x184D2A5) {
        return b4(dat, 4) + 8;
    }
    err(0);
};
const msb = (val)=>{
    let bits = 0;
    for(; 1 << bits <= val; ++bits);
    return bits - 1;
};
const rfse = (dat, bt, mal)=>{
    let tpos = (bt << 3) + 4;
    const al = (dat[bt] & 15) + 5;
    if (al > mal) err(3);
    const sz = 1 << al;
    let probs = sz, sym = -1, re = -1, i = -1, ht = sz;
    const buf = new ab(512 + (sz << 2));
    const freq = new i16(buf, 0, 256);
    const dstate = new u16(buf, 0, 256);
    const nstate = new u16(buf, 512, sz);
    const bb1 = 512 + (sz << 1);
    const syms = new u8(buf, bb1, sz);
    const nbits = new u8(buf, bb1 + sz);
    while(sym < 255 && probs > 0){
        const bits = msb(probs + 1);
        const cbt = tpos >> 3;
        const msk = (1 << bits + 1) - 1;
        let val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (tpos & 7) & msk;
        const msk1fb = (1 << bits) - 1;
        const msv = msk - probs - 1;
        const sval = val & msk1fb;
        if (sval < msv) tpos += bits, val = sval;
        else {
            tpos += bits + 1;
            if (val > msk1fb) val -= msv;
        }
        freq[++sym] = --val;
        if (val == -1) {
            probs += val;
            syms[--ht] = sym;
        } else probs -= val;
        if (!val) {
            do {
                const rbt = tpos >> 3;
                re = (dat[rbt] | dat[rbt + 1] << 8) >> (tpos & 7) & 3;
                tpos += 2;
                sym += re;
            }while (re == 3)
        }
    }
    if (sym > 255 || probs) err(0);
    let sympos = 0;
    const sstep = (sz >> 1) + (sz >> 3) + 3;
    const smask = sz - 1;
    for(let s = 0; s <= sym; ++s){
        const sf = freq[s];
        if (sf < 1) {
            dstate[s] = -sf;
            continue;
        }
        for(i = 0; i < sf; ++i){
            syms[sympos] = s;
            do {
                sympos = sympos + sstep & smask;
            }while (sympos >= ht)
        }
    }
    if (sympos) err(0);
    for(i = 0; i < sz; ++i){
        const ns = dstate[syms[i]]++;
        const nb = nbits[i] = al - msb(ns);
        nstate[i] = (ns << nb) - sz;
    }
    return [
        tpos + 7 >> 3,
        {
            b: al,
            s: syms,
            n: nbits,
            t: nstate
        }
    ];
};
const rhu = (dat, bt)=>{
    let i = 0, wc = -1;
    const buf = new u8(292), hb = dat[bt];
    const hw = buf.subarray(0, 256);
    const rc = buf.subarray(256, 268);
    const ri = new u16(buf.buffer, 268);
    if (hb < 128) {
        const [ebt, fdt] = rfse(dat, bt + 1, 6);
        bt += hb;
        const epos = ebt << 3;
        const lb = dat[bt];
        if (!lb) err(0);
        let st1 = 0, st2 = 0, btr1 = fdt.b, btr2 = btr1;
        let fpos = (++bt << 3) - 8 + msb(lb);
        for(;;){
            fpos -= btr1;
            if (fpos < epos) break;
            let cbt = fpos >> 3;
            st1 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr1) - 1;
            hw[++wc] = fdt.s[st1];
            fpos -= btr2;
            if (fpos < epos) break;
            cbt = fpos >> 3;
            st2 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr2) - 1;
            hw[++wc] = fdt.s[st2];
            btr1 = fdt.n[st1];
            st1 = fdt.t[st1];
            btr2 = fdt.n[st2];
            st2 = fdt.t[st2];
        }
        if (++wc > 255) err(0);
    } else {
        wc = hb - 127;
        for(; i < wc; i += 2){
            const byte = dat[++bt];
            hw[i] = byte >> 4;
            hw[i + 1] = byte & 15;
        }
        ++bt;
    }
    let wes = 0;
    for(i = 0; i < wc; ++i){
        const wt = hw[i];
        if (wt > 11) err(0);
        wes += wt && 1 << wt - 1;
    }
    const mb = msb(wes) + 1;
    const ts = 1 << mb;
    const rem = ts - wes;
    if (rem & rem - 1) err(0);
    hw[wc++] = msb(rem) + 1;
    for(i = 0; i < wc; ++i){
        const wt = hw[i];
        ++rc[hw[i] = wt && mb + 1 - wt];
    }
    const hbuf = new u8(ts << 1);
    const syms = hbuf.subarray(0, ts), nb = hbuf.subarray(ts);
    ri[mb] = 0;
    for(i = mb; i > 0; --i){
        const pv = ri[i];
        fill(nb, i, pv, ri[i - 1] = pv + rc[i] * (1 << mb - i));
    }
    if (ri[0] != ts) err(0);
    for(i = 0; i < wc; ++i){
        const bits = hw[i];
        if (bits) {
            const code = ri[bits];
            fill(syms, i, code, ri[bits] = code + (1 << mb - bits));
        }
    }
    return [
        bt,
        {
            n: nb,
            b: mb,
            s: syms
        }
    ];
};
const dllt = rfse(new u8([
    81,
    16,
    99,
    140,
    49,
    198,
    24,
    99,
    12,
    33,
    196,
    24,
    99,
    102,
    102,
    134,
    70,
    146,
    4
]), 0, 6)[1];
const dmlt = rfse(new u8([
    33,
    20,
    196,
    24,
    99,
    140,
    33,
    132,
    16,
    66,
    8,
    33,
    132,
    16,
    66,
    8,
    33,
    68,
    68,
    68,
    68,
    68,
    68,
    68,
    68,
    36,
    9
]), 0, 6)[1];
const doct = rfse(new u8([
    32,
    132,
    16,
    66,
    102,
    70,
    68,
    68,
    68,
    68,
    36,
    73,
    2
]), 0, 5)[1];
const b2bl = (b, s)=>{
    const len = b.length, bl = new i32(len);
    for(let i = 0; i < len; ++i){
        bl[i] = s;
        s += 1 << b[i];
    }
    return bl;
};
const llb = new u8(new i32([
    0,
    0,
    0,
    0,
    16843009,
    50528770,
    134678020,
    202050057,
    269422093
]).buffer, 0, 36);
const llbl = b2bl(llb, 0);
const mlb = new u8(new i32([
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    16843009,
    50528770,
    117769220,
    185207048,
    252579084,
    16
]).buffer, 0, 53);
const mlbl = b2bl(mlb, 3);
const dhu = (dat, out, hu)=>{
    const len = dat.length, ss = out.length, lb = dat[len - 1], msk = (1 << hu.b) - 1, eb = -hu.b;
    if (!lb) err(0);
    let st = 0, btr = hu.b, pos = (len << 3) - 8 + msb(lb) - btr, i = -1;
    for(; pos > eb && i < ss;){
        const cbt = pos >> 3;
        const val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (pos & 7);
        st = (st << btr | val) & msk;
        out[++i] = hu.s[st];
        pos -= btr = hu.n[st];
    }
    if (pos != eb || i + 1 != ss) err(0);
};
const dhu4 = (dat, out, hu)=>{
    let bt = 6;
    const ss = out.length, sz1 = ss + 3 >> 2, sz2 = sz1 << 1, sz3 = sz1 + sz2;
    dhu(dat.subarray(bt, bt += dat[0] | dat[1] << 8), out.subarray(0, sz1), hu);
    dhu(dat.subarray(bt, bt += dat[2] | dat[3] << 8), out.subarray(sz1, sz2), hu);
    dhu(dat.subarray(bt, bt += dat[4] | dat[5] << 8), out.subarray(sz2, sz3), hu);
    dhu(dat.subarray(bt), out.subarray(sz3), hu);
};
const rzb = (dat, st, out)=>{
    let bt = st.b;
    const b0 = dat[bt], btype = b0 >> 1 & 3;
    st.l = b0 & 1;
    const sz = b0 >> 3 | dat[bt + 1] << 5 | dat[bt + 2] << 13;
    const ebt = (bt += 3) + sz;
    if (btype == 1) {
        if (bt >= dat.length) return;
        st.b = bt + 1;
        if (out) {
            fill(out, dat[bt], st.y, st.y += sz);
            return out;
        }
        return fill(new u8(sz), dat[bt]);
    }
    if (ebt > dat.length) return;
    if (btype == 0) {
        st.b = ebt;
        if (out) {
            out.set(dat.subarray(bt, ebt), st.y);
            st.y += sz;
            return out;
        }
        return slc(dat, bt, ebt);
    }
    if (btype == 2) {
        const b3 = dat[bt], lbt = b3 & 3, sf = b3 >> 2 & 3;
        let lss = b3 >> 4, lcs = 0, s4 = 0;
        if (lbt < 2) {
            if (sf & 1) lss |= dat[++bt] << 4 | (sf & 2 && dat[++bt] << 12);
            else lss = b3 >> 3;
        } else {
            s4 = sf;
            if (sf < 2) lss |= (dat[++bt] & 63) << 4, lcs = dat[bt] >> 6 | dat[++bt] << 2;
            else if (sf == 2) lss |= dat[++bt] << 4 | (dat[++bt] & 3) << 12, lcs = dat[bt] >> 2 | dat[++bt] << 6;
            else lss |= dat[++bt] << 4 | (dat[++bt] & 63) << 12, lcs = dat[bt] >> 6 | dat[++bt] << 2 | dat[++bt] << 10;
        }
        ++bt;
        let buf = out ? out.subarray(st.y, st.y + st.m) : new u8(st.m);
        let spl = buf.length - lss;
        if (lbt == 0) buf.set(dat.subarray(bt, bt += lss), spl);
        else if (lbt == 1) fill(buf, dat[bt++], spl);
        else {
            let hu = st.h;
            if (lbt == 2) {
                const hud = rhu(dat, bt);
                lcs += bt - (bt = hud[0]);
                st.h = hu = hud[1];
            } else if (!hu) err(0);
            (s4 ? dhu4 : dhu)(dat.subarray(bt, bt += lcs), buf.subarray(spl), hu);
        }
        let ns = dat[bt++];
        if (ns) {
            if (ns == 255) ns = (dat[bt++] | dat[bt++] << 8) + 0x7F00;
            else if (ns > 127) ns = ns - 128 << 8 | dat[bt++];
            const scm = dat[bt++];
            if (scm & 3) err(0);
            const dts = [
                dmlt,
                doct,
                dllt
            ];
            for(let i = 2; i > -1; --i){
                const md = scm >> (i << 1) + 2 & 3;
                if (md == 1) {
                    const rbuf = new u8([
                        0,
                        0,
                        dat[bt++]
                    ]);
                    dts[i] = {
                        s: rbuf.subarray(2, 3),
                        n: rbuf.subarray(0, 1),
                        t: new u16(rbuf.buffer, 0, 1),
                        b: 0
                    };
                } else if (md == 2) {
                    [bt, dts[i]] = rfse(dat, bt, 9 - (i & 1));
                } else if (md == 3) {
                    if (!st.t) err(0);
                    dts[i] = st.t[i];
                }
            }
            const [mlt, oct, llt] = st.t = dts;
            const lb = dat[ebt - 1];
            if (!lb) err(0);
            let spos = (ebt << 3) - 8 + msb(lb) - llt.b, cbt = spos >> 3, oubt = 0;
            let lst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << llt.b) - 1;
            cbt = (spos -= oct.b) >> 3;
            let ost = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << oct.b) - 1;
            cbt = (spos -= mlt.b) >> 3;
            let mst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mlt.b) - 1;
            for(++ns; --ns;){
                const llc = llt.s[lst];
                const lbtr = llt.n[lst];
                const mlc = mlt.s[mst];
                const mbtr = mlt.n[mst];
                const ofc = oct.s[ost];
                const obtr = oct.n[ost];
                cbt = (spos -= ofc) >> 3;
                const ofp = 1 << ofc;
                let off = ofp + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16 | dat[cbt + 3] << 24) >>> (spos & 7) & ofp - 1);
                cbt = (spos -= mlb[mlc]) >> 3;
                let ml = mlbl[mlc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << mlb[mlc]) - 1);
                cbt = (spos -= llb[llc]) >> 3;
                const ll = llbl[llc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << llb[llc]) - 1);
                cbt = (spos -= lbtr) >> 3;
                lst = llt.t[lst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << lbtr) - 1);
                cbt = (spos -= mbtr) >> 3;
                mst = mlt.t[mst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mbtr) - 1);
                cbt = (spos -= obtr) >> 3;
                ost = oct.t[ost] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << obtr) - 1);
                if (off > 3) {
                    st.o[2] = st.o[1];
                    st.o[1] = st.o[0];
                    st.o[0] = off -= 3;
                } else {
                    const idx = off - (ll != 0);
                    if (idx) {
                        off = idx == 3 ? st.o[0] - 1 : st.o[idx];
                        if (idx > 1) st.o[2] = st.o[1];
                        st.o[1] = st.o[0];
                        st.o[0] = off;
                    } else off = st.o[0];
                }
                for(let i = 0; i < ll; ++i){
                    buf[oubt + i] = buf[spl + i];
                }
                oubt += ll, spl += ll;
                let stin = oubt - off;
                if (stin < 0) {
                    let len = -stin;
                    const bs = st.e + stin;
                    if (len > ml) len = ml;
                    for(let i = 0; i < len; ++i){
                        buf[oubt + i] = st.w[bs + i];
                    }
                    oubt += len, ml -= len, stin = 0;
                }
                for(let i = 0; i < ml; ++i){
                    buf[oubt + i] = buf[stin + i];
                }
                oubt += ml;
            }
            if (oubt != spl) {
                while(spl < buf.length){
                    buf[oubt++] = buf[spl++];
                }
            } else oubt = buf.length;
            if (out) st.y += oubt;
            else buf = slc(buf, 0, oubt);
        } else if (out) {
            st.y += lss;
            if (spl) {
                for(let i = 0; i < lss; ++i){
                    buf[i] = buf[spl + i];
                }
            }
        } else if (spl) buf = slc(buf, spl);
        st.b = ebt;
        return buf;
    }
    err(2);
};
const cct = (bufs, ol)=>{
    if (bufs.length == 1) return bufs[0];
    const buf = new u8(ol);
    for(let i = 0, b = 0; i < bufs.length; ++i){
        const chk = bufs[i];
        buf.set(chk, b);
        b += chk.length;
    }
    return buf;
};
function decompress(dat, buf) {
    const bufs = [], nb = +!buf;
    let bt = 0, ol = 0;
    for(; dat.length;){
        const st = rzfh(dat, nb || buf);
        if (typeof st == 'object') {
            if (nb) {
                buf = null;
                if (st.w.length == st.u) {
                    bufs.push(buf = st.w);
                    ol += st.u;
                }
            } else {
                bufs.push(buf);
                st.e = 0;
            }
            for(; !st.l;){
                const blk = rzb(dat, st, buf);
                if (!blk) err(5);
                if (buf) st.e = st.y;
                else {
                    bufs.push(blk);
                    ol += blk.length;
                    cpw(st.w, 0, blk.length);
                    st.w.set(blk, st.w.length - blk.length);
                }
            }
            bt = st.b + st.c * 4;
        } else bt = st;
        dat = dat.subarray(bt);
    }
    return cct(bufs, ol);
}
class Decompress {
    s;
    c;
    l;
    z;
    constructor(ondata){
        this.ondata = ondata;
        this.c = [];
        this.l = 0;
        this.z = 0;
    }
    push(chunk, final) {
        if (typeof this.s == 'number') {
            const sub = Math.min(chunk.length, this.s);
            chunk = chunk.subarray(sub);
            this.s -= sub;
        }
        const sl = chunk.length;
        const ncs = sl + this.l;
        if (!this.s) {
            if (final) {
                if (!ncs) {
                    this.ondata(new u8(0), true);
                    return;
                }
                if (ncs < 5) err(5);
            } else if (ncs < 18) {
                this.c.push(chunk);
                this.l = ncs;
                return;
            }
            if (this.l) {
                this.c.push(chunk);
                chunk = cct(this.c, ncs);
                this.c = [];
                this.l = 0;
            }
            if (typeof (this.s = rzfh(chunk)) == 'number') return this.push(chunk, final);
        }
        if (typeof this.s != 'number') {
            if (ncs < (this.z || 3)) {
                if (final) err(5);
                this.c.push(chunk);
                this.l = ncs;
                return;
            }
            if (this.l) {
                this.c.push(chunk);
                chunk = cct(this.c, ncs);
                this.c = [];
                this.l = 0;
            }
            if (!this.z && ncs < (this.z = chunk[this.s.b] & 2 ? 4 : 3 + (chunk[this.s.b] >> 3 | chunk[this.s.b + 1] << 5 | chunk[this.s.b + 2] << 13))) {
                if (final) err(5);
                this.c.push(chunk);
                this.l = ncs;
                return;
            } else this.z = 0;
            for(;;){
                const blk = rzb(chunk, this.s);
                if (!blk) {
                    if (final) err(5);
                    const adc = chunk.subarray(this.s.b);
                    this.s.b = 0;
                    this.c.push(adc), this.l += adc.length;
                    return;
                } else {
                    this.ondata(blk, false);
                    cpw(this.s.w, 0, blk.length);
                    this.s.w.set(blk, this.s.w.length - blk.length);
                }
                if (this.s.l) {
                    const rest = chunk.subarray(this.s.b);
                    this.s = this.s.c * 4;
                    this.push(rest, final);
                    return;
                }
            }
        } else if (final) err(5);
    }
    ondata;
}

return { decompress };
})();
if (typeof module !== "undefined") module.exports = FZSTD;
